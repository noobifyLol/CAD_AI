#include <curl/curl.h>
#include <openssl/hmac.h>
#include <openssl/evp.h>
#include <openssl/bio.h>
#include <openssl/buffer.h>
#include <chrono>
#include <string>
#include <cstring>
#include <sstream>
#include <cstdlib>
#include <iostream>
#include <fstream>
#include <algorithm>
#include <iomanip>
#include <thread>
#include "json.hpp"
#include "onshapeID.cpp"

using namespace std;

// --- UTILITY FUNCTIONS ---

// Captures the API response into a string
size_t WriteCallback(void* contents, size_t size, size_t nmemb, string* userp) {
    userp->append((char*)contents, size * nmemb);
    return size * nmemb;
}

// Converts raw bytes to Base64 (Required for Onshape Signature)
string base64Encode(const unsigned char* buffer, size_t length) {
    BIO *bio, *b64;
    BUF_MEM *bufferPtr;
    b64 = BIO_new(BIO_f_base64());
    BIO_set_flags(b64, BIO_FLAGS_BASE64_NO_NL); // Important: No newlines in encoded string
    bio = BIO_new(BIO_s_mem());
    bio = BIO_push(b64, bio);
    BIO_write(bio, buffer, length);
    BIO_flush(bio);
    BIO_get_mem_ptr(bio, &bufferPtr);
    string result(bufferPtr->data, bufferPtr->length);
    BIO_free_all(bio);
    return result;
}

// Loads keys from .env or System Environment
bool loadApiKeys(string& accessKey, string& secretKey) {
    // Try loading from .env first
    ifstream envFile(".env");
    if (envFile.is_open()) {
        string line;
        while (getline(envFile, line)) {
            line.erase(remove(line.begin(), line.end(), ' '), line.end());
            line.erase(remove(line.begin(), line.end(), '\''), line.end());
            line.erase(remove(line.begin(), line.end(), '\"'), line.end());

            size_t delim = line.find('=');
            if (delim != string::npos) {
                string key = line.substr(0, delim);
                string value = line.substr(delim + 1);
                if (key == "ONSHAPE_ACCESS_KEY") accessKey = value;
                if (key == "ONSHAPE_SECRET_KEY") secretKey = value;
            }
        }
        envFile.close();
    }

    // Fallback to System Environment Variables if .env failed
    if (accessKey.empty() || secretKey.empty()) {
        const char* envA = getenv("ONSHAPE_ACCESS_KEY");
        const char* envS = getenv("ONSHAPE_SECRET_KEY");
        if (envA) accessKey = envA;
        if (envS) secretKey = envS;
    }

    if (accessKey.empty() || secretKey.empty()) {
        cerr << "Error: Could not find API keys in .env or environment variables." << endl;
        return false;
    }
    return true;
}

// Generate the HMAC-SHA256 signature
string generateSignature(const string& method, const string& path, 
                        const string& secretKey, const string& nonce, 
                        const string& timestamp, const string& contentType) {
    
    // Onshape's specific signature string format:
    // Method + \n + Nonce + \n + Date + \n + ContentType + \n + Path + \n + Query + \n
    // Note: Everything must be lowercased before hashing
    string msg = method + "\n" + nonce + "\n" + timestamp + "\n" + contentType + "\n" + path + "\n\n";
    for(auto &c : msg) c = tolower(c);

    unsigned char hash[EVP_MAX_MD_SIZE];
    unsigned int hashLen;
    
    HMAC(EVP_sha256(), (unsigned char*)secretKey.c_str(), secretKey.length(),
         (unsigned char*)msg.c_str(), msg.length(), hash, &hashLen);
    
    return base64Encode(hash, hashLen);
}

string getVariablePath(string docId, string workspaceId, string elementId) {
    return "/api/variables/d/" + docId + "/w/" + workspaceId + "/e/" + elementId;
}


void startPollingLoop(string doc, string work, string elem){
    string accessKey, secretKey;

    if(!loadApiKeys(accessKey,secretKey)) return ;

    string path = getVariablePath(doc,work,elem);
    string url = "https://cad.onshape.com" + path;

    cout << "Bridge Active. Watching Document: " << doc << endl;

    while (true){
        CURL *curl = curl_easy_init();
        if (curl) {
            time_t now = time(0);
            struct tm tm = *gmtime(&now);
            char buf[100];
            strftime(buf, sizeof(buf), "%a, %d %b %Y %H:%M:%S GMT", &tm);
            string timestamp(buf);
            string nonce = "nonce_" + to_string(chrono::system_clock::now().time_since_epoch().count());
            string signature = generateSignature("GET", path, secretKey, nonce, timestamp, "application/json");

            struct curl_slist *headers = NULL;
            headers = curl_slist_append(headers, ("Date: " + timestamp).c_str());
            headers = curl_slist_append(headers, ("On-Nonce: " + nonce).c_str());
            headers = curl_slist_append(headers, "Accept: application/vnd.onshape.v1+json");
            headers = curl_slist_append(headers, ("Authorization: On " + accessKey + ":HmacSHA256:" + signature).c_str());

            string response;
            curl_easy_setopt(curl, CURLOPT_URL, url.c_str());
            curl_easy_setopt(curl, CURLOPT_HTTPHEADER, headers);
            curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, WriteCallback);
            curl_easy_setopt(curl, CURLOPT_WRITEDATA, &response);
            curl_easy_setopt(curl, CURLOPT_SSL_VERIFYPEER, 0L);


            CURLcode res = curl_easy_perform(curl);

            if (res == CURLE_OK) {
                // 4. CHECK FOR PENDING STATUS
                // In a real app, use a JSON library. For a quick test, we use .find()
                if (response.find("\"name\": \"Architect_Status\"") != string::npos && 
                    response.find("\"value\": \"PENDING\"") != string::npos) {
                    
                    cout << "\n[!] NEW PROMPT DETECTED!" << endl;
                    
                    // TODO: Extract the "Architect_Payload" from the response string
                    // TODO: Call your AI function here
                    // TODO: Send a POST request to Onshape to set status to "PROCESSING"
                } else {
                    // Just a heartbeat so you know it's working
                    cout << "." << flush; 
                }
            }

            // Cleanup this iteration
            curl_slist_free_all(headers);
            curl_easy_cleanup(curl);
        }

        // 5. WAIT: Don't spam the API! 2-5 seconds is usually safe.
        this_thread::sleep_for(chrono::milliseconds(2000));
    }
}



int main() {
    cout << "Initializing Autonomous CAD Architect Bridge..." << endl;
    OnshapeIDs ids = parseUrl("https://cad.onshape.com/documents/c1fbbbb30348e3d729c9e329/w/f462715c39b4372c5d5dfb96/e/68fcbf0cb5c9cbcaf2cfebf8");
    
    string doc = ids.docId;
    string work = ids.workId;
    string elem = ids.elemId;

    startPollingLoop(doc,work,elem);
    return 0;
}