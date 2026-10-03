#pragma once
#ifdef CASTLETEK_WLED_COMPAT
void castleTekWLEDRegisterSyncRoutes();
void castleTekWLEDSerializeSyncInfo(JsonObject root);
void castleTekWLEDPrintSync(Print& output);
void castleTekWLEDSyncSettingsChanged(bool radioWasEnabled);
bool castleTekWLEDSyncConfigLoaded(JsonObject root, bool fromFS);
void castleTekWLEDSerializeSyncConfig(JsonObject sync);
bool castleTekWLEDSyncRadioEnabled();
bool castleTekWLEDSyncUsesOfflineAP();
bool castleTekWLEDSyncConnectionChangeAllowed();
uint8_t castleTekWLEDSyncOfflineChannel();
bool castleTekWLEDSyncOfflineHeld();
bool castleTekWLEDHandleSyncConnection();
void castleTekWLEDResumeWiFi();
void castleTekWLEDSyncConnectionReset();
void castleTekWLEDSyncConfigSaved(bool success, JsonObject root);
bool castleTekWLEDValidateSyncSettings(AsyncWebServerRequest* request);
void castleTekWLEDApplySyncSettings(AsyncWebServerRequest* request);
bool castleTekWLEDSyncSenderAllowed(const char* source);
void castleTekWLEDReceiveSync(const uint8_t* address, const uint8_t* data, size_t length, bool broadcast);
bool castleTekWLEDTakeSync(uint8_t* data, size_t capacity);
// Copy complete notifications; all LAN I/O and lighting application stay in the main loop.
bool castleTekWLEDQueueLANSync(const uint8_t* data, size_t length);
bool castleTekWLEDReceiveLANSync(const uint8_t* data, size_t length);
void castleTekWLEDHandleSync();
void castleTekWLEDSyncRadioStarted(bool onAP);
#endif
