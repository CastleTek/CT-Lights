#pragma once

class AsyncWebServerRequest;

#ifdef CASTLETEK_WLED_COMPAT
void serializeCastleTekUpdateInfo(JsonObject castleTek);
#ifndef WLED_DISABLE_OTA
void handleCastleTekOTABody(AsyncWebServerRequest* request, uint8_t* data, size_t len, size_t index, size_t total, bool localSource);
void completeCastleTekOTA(AsyncWebServerRequest* request, bool localSource);
#endif
#endif
