#include "auth.h"
#include "connection.h"
#include "ai_logic.h"
#include <iostream>
#include <thread>

int main() {
    // 1. Get the Access Token from the Handshake
    std::string token = start_handshake(); 
    
    // 2. These IDs come from your Onshape URL
    // URL format: cad.onshape.com/documents/DID/w/WID/e/EID
    std::string DID = "YOUR_DOC_ID";
    std::string WID = "YOUR_WORKSPACE_ID";
    std::string EID = "YOUR_ELEMENT_ID";

    std::string last_prompt = "";

    std::cout << "AI Architect is watching for prompts..." << std::endl;

    while (true) {
        // 3. Poll Onshape to see if you typed something in the Relay
        std::string current_prompt = get_latest_prompt(token, DID, WID, EID);

        if (!current_prompt.empty() && current_prompt != last_prompt) {
            std::cout << "New Prompt: " << current_prompt << std::endl;

            // 4. Send to Llama 4 Scout for the JSON blueprint
            std::string ai_json = call_groq_api(current_prompt);

            // 5. Send that JSON back to Onshape to build the part!
            push_to_onshape(token, ai_json, DID, WID, EID);

            last_prompt = current_prompt;
        }

        // Wait 2 seconds before checking again to avoid API limits
        std::this_thread::sleep_for(std::chrono::seconds(2));
    }
    return 0;
}