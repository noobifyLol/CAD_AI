#define CPPHTTPLIB_OPENSSL_SUPPORT
#include "httplib.h" 
#include <openssl/evp.h>
#include <openssl/bio.h>
#include <openssl/buffer.h>
#include <openssl/hmac.h>
#include "json.hpp"
#include <iostream>
#include <fstream>
#include <sstream>
#include <string>
#include <map>

const std::string REDIRECT_URI = "http://localhost:3000";

std::map<std::string, std::string> load_env() {
    std::map<std::string, std::string> env;
    std::ifstream file(".env"); 
    std::string line;
    
    while (std::getline(file, line)) {
        std::istringstream is_line(line);
        std::string key;
        if (std::getline(is_line, key, '=')) {
            std::string value;
            if (std::getline(is_line, value)) {
                env[key] = value;
            }
        }
    }
    return env;
}

// Updated to return the string and accept the keys
std::string exchange_code_for_token(std::string auth_code, std::string client_id, std::string client_secret) {
    httplib::Client cli("https://oauth.onshape.com");
    httplib::Params params;
    params.emplace("grant_type", "authorization_code");
    params.emplace("code", auth_code);
    params.emplace("client_id", client_id);
    params.emplace("client_secret", client_secret);
    params.emplace("redirect_uri", REDIRECT_URI);

    auto res = cli.Post("/oauth/token", params);

    if (res && res->status == 200) {
        auto j = nlohmann::json::parse(res->body);
        std::cout << "Successfully obtained Access Token!" << std::endl;
        return j["access_token"]; // Return the actual token!
    } else {
        std::cerr << "Failed to exchange code." << std::endl;
        return "";
    }
}

// Updated to return a string
std::string start_handshake() {
    auto env = load_env();
    std::string CLIENT_ID = env["OAuth_client_identifier"];
    std::string CLIENT_SECRET = env["Secret_Key"];

    httplib::Server svr;
    std::string auth_url = "https://oauth.onshape.com/oauth/authorize?response_type=code&client_id=" + CLIENT_ID + "&redirect_uri=" + REDIRECT_URI;

    std::cout << "Please log in here: " << auth_url << std::endl;

    std::string final_token = ""; // Store it here

    svr.Get("/", [&](const httplib::Request& req, httplib::Response& res) {
        if (req.has_param("code")) {
            std::string code = req.get_param_value("code");
            res.set_content("Login Successful! You can close this tab.", "text/plain");
            
            // CALL the exchange function and save the token!
            final_token = exchange_code_for_token(code, CLIENT_ID, CLIENT_SECRET);
            svr.stop(); 
        }
    });

    svr.listen("localhost", 3000); // This pauses the program until login is done
    return final_token; // Pass it back to main.cpp
}