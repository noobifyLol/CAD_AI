#ifndef AUTH_H
#define AUTH_H
#include <string>
#include <map>

std::map<std::string, std::string> load_env();
std::string start_handshake(); // Update this to return the access_token
#endif