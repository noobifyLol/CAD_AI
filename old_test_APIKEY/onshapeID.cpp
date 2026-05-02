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


struct OnshapeIDs {
    std::string docId;
    std::string workId;
    std::string elemId;
    bool valid = false;
};

OnshapeIDs parseUrl(std::string url) {
    OnshapeIDs ids;
    
    // Landmarks
    std::string docMarker = "/documents/";
    std::string workMarker = "/w/";
    std::string elemMarker = "/e/";

    size_t dStart = url.find(docMarker);
    size_t wStart = url.find(workMarker);
    size_t eStart = url.find(elemMarker);

    // Basic validation: make sure all markers exist
    if (dStart == std::string::npos || wStart == std::string::npos || eStart == std::string::npos) {
        return ids; 
    }

    // Extraction Math
    // We start after the marker and take everything up to the next landmark
    ids.docId = url.substr(dStart + docMarker.length(), wStart - (dStart + docMarker.length()));
    ids.workId = url.substr(wStart + workMarker.length(), eStart - (wStart + workMarker.length()));
    ids.elemId = url.substr(eStart + elemMarker.length());
    
    ids.valid = true;
    return ids;
}