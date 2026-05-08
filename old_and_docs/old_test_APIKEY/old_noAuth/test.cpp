#include <curl/curl.h>
#include <openssl/evp.h>
#include <openssl/bio.h>
#include <openssl/buffer.h>
#include <string>
#include <iostream>
#include <fstream>
#include <algorithm>
#include <thread>
#include <vector>
#include <cmath>
#include "json.hpp"

using namespace std;
using json = nlohmann::json;

// ============================================================
// AUTH + HTTP 
// ============================================================

string base64Encode(const unsigned char* buf, size_t len) {
    BIO* mem = BIO_new(BIO_s_mem());
    BIO* b64 = BIO_new(BIO_f_base64());
    BIO_set_flags(b64, BIO_FLAGS_BASE64_NO_NL);
    mem = BIO_push(b64, mem);
    BIO_write(mem, buf, len);
    BIO_flush(mem);
    BUF_MEM* p; BIO_get_mem_ptr(mem, &p);
    string r(p->data, p->length);
    BIO_free_all(mem);
    return r;
}

string basicAuth(const string& ak, const string& sk) {
    string c = ak+":"+sk;
    return "Basic "+base64Encode((const unsigned char*)c.c_str(), c.size());
}

bool loadKeys(string& ak, string& sk) {
    ifstream f(".env"); string line;
    while (getline(f, line)) {
        if (!line.empty() && line.back()=='\r') line.pop_back();
        line.erase(remove(line.begin(),line.end(),' '),line.end());
        size_t d=line.find('='); if(d==string::npos) continue;
        string k=line.substr(0,d), v=line.substr(d+1);
        if(k=="ONSHAPE_ACCESS_KEY") ak=v;
        if(k=="ONSHAPE_SECRET_KEY") sk=v;
    }
    return !ak.empty()&&!sk.empty();
}

size_t wcb(void* c,size_t s,size_t n,string* u){u->append((char*)c,s*n);return s*n;}

pair<long,string> req(const string& method, const string& path,
                      const string& ak, const string& sk,
                      const string& body="") {
    CURL* curl=curl_easy_init();
    string url="https://cad.onshape.com"+path;
    struct curl_slist* h=NULL;
    h=curl_slist_append(h,"Content-Type: application/json");
    h=curl_slist_append(h,"Accept: application/json;charset=UTF-8;qs=0.09");
    h=curl_slist_append(h,("Authorization: "+basicAuth(ak,sk)).c_str());
    curl_easy_setopt(curl,CURLOPT_URL,url.c_str());
    curl_easy_setopt(curl,CURLOPT_HTTPHEADER,h);
    curl_easy_setopt(curl,CURLOPT_SSL_VERIFYPEER,0L);
    string rb; curl_easy_setopt(curl,CURLOPT_WRITEFUNCTION,wcb);
    curl_easy_setopt(curl,CURLOPT_WRITEDATA,&rb);
    
    if(method=="POST"){
        curl_easy_setopt(curl,CURLOPT_POSTFIELDS,body.c_str());
        curl_easy_setopt(curl,CURLOPT_POSTFIELDSIZE,(long)body.size());
    } else if(method=="DELETE") {
        curl_easy_setopt(curl,CURLOPT_CUSTOMREQUEST,"DELETE");
    } else {
        curl_easy_setopt(curl,CURLOPT_HTTPGET,1L);
    }
    
    CURLcode res=curl_easy_perform(curl);
    long code=0;
    if(res==CURLE_OK) curl_easy_getinfo(curl,CURLINFO_RESPONSE_CODE,&code);
    else rb="CURL Error: "+string(curl_easy_strerror(res));
    
    curl_slist_free_all(h); curl_easy_cleanup(curl);
    return {code,rb};
}

struct IDs { string doc,work,elem; bool ok=false; };
IDs parseUrl(const string& url) {
    IDs ids;
    auto get=[&](const string& key) -> string {
        size_t p=url.find("/"+key+"/"); if(p==string::npos) return "";
        p+=key.size()+2; size_t e=url.find("/",p);
        return url.substr(p, e==string::npos ? string::npos : e-p);
    };
    ids.doc=get("documents"); ids.work=get("w"); ids.elem=get("e");
    ids.ok=!ids.doc.empty()&&!ids.work.empty()&&!ids.elem.empty();
    return ids;
}

// ============================================================
// DELETE EXISTING FEATURES
// ============================================================
int deleteAll(const IDs& ids, const string& ak, const string& sk) {
    string path="/api/v9/partstudios/d/"+ids.doc+"/w/"+ids.work+"/e/"+ids.elem+"/features";
    auto [c,b]=req("GET",path,ak,sk);
    if(c!=200){ cout<<"GET features failed: "<<c<<endl; return 0; }

    json resp=json::parse(b);
    vector<string> fids;
    for(auto& f : resp["features"]) {
        string fid="";
        if(f.contains("message") && f["message"].contains("featureId"))
            fid=f["message"]["featureId"].get<string>();
        else if(f.contains("featureId"))
            fid=f["featureId"].get<string>();
        if(!fid.empty()) fids.push_back(fid);
    }

    if(fids.empty()) return 0;

    reverse(fids.begin(), fids.end());
    for(auto& fid : fids){
        string dp=path+"/featureid/"+fid;
        req("DELETE",dp,ak,sk);
        this_thread::sleep_for(chrono::milliseconds(200));
    }
    return fids.size();
}

string getMVAndSV(const IDs& ids, const string& ak, const string& sk, string& sv) {
    string path="/api/v9/partstudios/d/"+ids.doc+"/w/"+ids.work+"/e/"+ids.elem+"/features";
    auto [c,b]=req("GET",path,ak,sk);
    sv="";
    if(c==200){
        try{
            json r=json::parse(b);
            sv=r.value("serializationVersion","");
            return r.value("microversion","");
        }catch(...){}
    }
    return "";
}

// ============================================================
// CREATE CUBE (2 API Calls: Sketch + Extrude)
// ============================================================
void createCube(const IDs& ids, const string& ak, const string& sk) {
    string sv, mv = getMVAndSV(ids, ak, sk, sv);
    string featPath="/api/v9/partstudios/d/"+ids.doc+"/w/"+ids.work+"/e/"+ids.elem+"/features";

    // 1. PERFECTLY DEFINED SKETCH (No message wrappers)
    double h = 0.025; // 25mm half-size (50mm total)
    auto makeLine = [](const string& id, double x1, double y1, double x2, double y2) {
        double dx = x2 - x1, dy = y2 - y1;
        double len = sqrt(dx*dx + dy*dy);
        return json{
            {"btType", "BTMSketchCurve-4"},
            {"entityId", id},
            {"geometry", {
                {"btType", "BTCurveGeometryLine-117"},
                {"pntX", x1}, {"pntY", y1},
                {"dirX", dx/len}, {"dirY", dy/len}
            }},
            {"startParam", 0.0},
            {"endParam", len}
        };
    };

    json entities = json::array({
        makeLine("sq_b", -h,-h,  h,-h), 
        makeLine("sq_r",  h,-h,  h, h), 
        makeLine("sq_t",  h, h, -h, h), 
        makeLine("sq_l", -h, h, -h,-h)  
    });

    json sketchFeature = {
        {"btType", "BTMSketch-151"},
        {"featureId", "cubeSketch_AI"},
        {"featureType", "newSketch"},
        {"name", "AI Cube Sketch"},
        {"parameters", json::array({{
            {"btType", "BTMParameterQueryList-148"},
            {"parameterId", "sketchPlane"},
            {"queries", json::array({{
                {"btType", "BTMIndividualQuery-138"},
                {"queryString", "qCreatedBy(makeId(\"Top\"), EntityType.FACE)"}
            }})}
        }})},
        {"entities", entities},
        {"constraints", json::array()}
    };

    json sketchPayload = {
        {"btType", "BTFeatureDefinitionCall-1406"},
        {"feature", sketchFeature}
    };
    if(!sv.empty()) sketchPayload["serializationVersion"] = sv;
    if(!mv.empty()) sketchPayload["sourceMicroversion"]   = mv;

    auto [sc,sb] = req("POST", featPath, ak, sk, sketchPayload.dump());
    if(sc != 200 && sc != 201) { cout<<"Sketch Error: "<<sb<<endl; return; }
    
    this_thread::sleep_for(chrono::milliseconds(300));
    mv = getMVAndSV(ids, ak, sk, sv);

    // 2. BLIND EXTRUDE
    json extFeature = {
        {"btType", "BTMFeature-134"},
        {"featureId", "cubeExtrude_AI"},
        {"featureType", "extrude"},
        {"name", "AI Cube"},
        {"parameters", json::array({
            {{"btType", "BTMParameterEnum-145"}, {"parameterId", "operationType"}, {"value", "NEW"}, {"enumName", "NewBodyOperationType"}},
            {{"btType", "BTMParameterEnum-145"}, {"parameterId", "endBound"}, {"value", "BLIND"}, {"enumName", "BoundingType"}},
            {{"btType", "BTMParameterQuantity-147"}, {"parameterId", "depth"}, {"expression", "50 mm"}},
            {
                {"btType", "BTMParameterQueryList-148"}, 
                {"parameterId", "entities"},
                {"queries", json::array({{
                    {"btType", "BTMIndividualSketchRegionQuery-140"}, 
                    {"featureId", "cubeSketch_AI"}
                }})}
            }
        })}
    };

    json extPayload = {
        {"btType", "BTFeatureDefinitionCall-1406"},
        {"feature", extFeature}
    };
    if(!sv.empty()) extPayload["serializationVersion"] = sv;
    if(!mv.empty()) extPayload["sourceMicroversion"]   = mv;

    auto [ec,eb] = req("POST", featPath, ak, sk, extPayload.dump());
    if(ec == 200 || ec == 201) cout << "SUCCESS! Cube created properly in Onshape." << endl;
    else cout << "Extrude Error: " << eb << endl;
}

// ============================================================
// MAIN
// ============================================================
int main() {
    string ak,sk;
    if(!loadKeys(ak,sk)) return 1;

    string url="https://cad.onshape.com/documents/c1fbbbb30348e3d729c9e329/w/f462715c39b4372c5d5dfb96/e/68fcbf0cb5c9cbcaf2cfebf8";
    IDs ids=parseUrl(url);
    if(!ids.ok) return 1;

    cout << "Cleaning up existing features..." << endl;
    deleteAll(ids, ak, sk);
    this_thread::sleep_for(chrono::milliseconds(500));

    cout << "Generating new perfect Cube (Sketch + Extrude)..." << endl;
    createCube(ids, ak, sk);

    return 0;
}