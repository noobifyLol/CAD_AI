#define CPPHTTPLIB_OPENSSL_SUPPORT
#include "httplib.h" // Ensure this file is in your include path or project directory
#include "auth.h"
#include <openssl/evp.h>
#include <openssl/bio.h>
#include <openssl/buffer.h>
#include <openssl/hmac.h>
#include "json.hpp"
#include <iostream>
#include <string>

using json = nlohmann::json;

std::string call_groq_api(const std::string& prompt){
    auto env = load_env();
    httplib::Client cli("https://api.groq.com");
    json body = {
        {"model", "meta-llama/llama-4-scout-17b-16e-instruct"}, //
        {"messages", {
            {{"role", "system"}, {"content", "You are an Onshape expert. Output ONLY JSON for BTMFeature-134."}},
            {{"role", "user"}, {"content", prompt}}
        }}
    };

    httplib::Headers headers = {
        {"Authorization", "Bearer " + env["AI_MODEL_API"]}, //
        {"Content-Type", "application/json"}
    };

    auto res = cli.Post("/openai/v1/chat/completions", headers, body.dump(), "application/json");
    return json::parse(res->body)["choices"][0]["message"]["content"];
}
