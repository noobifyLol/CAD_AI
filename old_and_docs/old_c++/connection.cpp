#define CPPHTTPLIB_OPENSSL_SUPPORT
#include "httplib.h" 
#include "json.hpp"
#include <iostream>

using json = nlohmann::json;

// Added "token" parameter and headers
std::string get_latest_prompt(const std::string& token, const std::string& did, const std::string& wid, const std::string& eid) {
    httplib::Client cli("https://cad.onshape.com");
    
    // You MUST send the token so Onshape knows it's you!
    httplib::Headers headers = {
        {"Authorization", "Bearer " + token},
        {"Accept", "application/vnd.onshape.v2+json"}
    };

    auto res = cli.Get(("/api/partstudios/d/" + did + "/w/" + wid + "/e/" + eid + "/features").c_str(), headers);
    
    if (res && res->status == 200) {
        json data = json::parse(res->body);
        for (auto& feature : data["features"]) {
            if (feature["name"] == "AI Architect Relay 1") {
                return feature["parameters"][0]["expression"]; 
            }
        }
    }
    return "";
}

// Placeholder so main.cpp can compile. We will build the real logic for this next!
void push_to_onshape(const std::string& token, const std::string& json_payload, const std::string& did, const std::string& wid, const std::string& eid) {
    std::cout << "\n[SIMULATED PUSH TO ONSHAPE] Blueprint ready:\n" << json_payload << std::endl;
}