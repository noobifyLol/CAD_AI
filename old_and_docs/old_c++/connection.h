#ifndef CONNECTION_H
#define CONNECTION_H
#include <string>

std::string get_latest_prompt(const std::string& token, const std::string& did, const std::string& wid, const std::string& eid);
void push_to_onshape(const std::string& token, const std::string& json_payload, const std::string& did, const std::string& wid, const std::string& eid);
#endif