#include "castletek_update_policy.h"
#include <algorithm>
#include <cstdlib>
#include <iostream>
#include <string>
#include <vector>

static unsigned checks;
#define CHECK(x) do { ++checks; if (!(x)) { std::cerr << "check failed at line " << __LINE__ << ": " << #x << '\n'; std::exit(1); } } while (0)

static void append32(std::vector<uint8_t>& bytes, uint32_t value) {
  for (unsigned i = 0; i < 4; i++) bytes.push_back(uint8_t(value >> (8 * i)));
}

// Construct the documented ESP32 raw layout independently of the stream parser.
// The appended digest is checked by the hardware adapter/ESP-IDF at activation.
static std::vector<uint8_t> rawImage(unsigned variation = 0) {
  std::vector<uint8_t> image(24, 0);
  image[0] = 0xe9;
  image[1] = 3;
  image[23] = 1;
  uint8_t checksum = 0xef;
  for (size_t count : {size_t(800 + variation), size_t(0), size_t(31 + variation)}) {
    append32(image, 0x3f400000);
    append32(image, uint32_t(count));
    for (size_t i = 0; i < count; i++) {
      uint8_t value = uint8_t(i * 37 + variation);
      if (image.size() >= 32 && image.size() < 36) {
        const uint8_t appMagic[] = {0x32, 0x54, 0xcd, 0xab};
        value = appMagic[image.size() - 32];
      }
      image.push_back(value);
      checksum ^= value;
    }
  }
  while (image.size() % 16 != 15) image.push_back(0);
  image.push_back(checksum);
  image.resize(image.size() + 32, 0x9a);
  return image;
}

static bool accepts(const std::vector<uint8_t>& bytes, size_t chunk = 1) {
  CastleTekUpdate::ImageStream stream(bytes.size());
  for (size_t i = 0; i < bytes.size(); i += chunk) {
    const size_t count = std::min(chunk, bytes.size() - i);
    if (!stream.feed(i, bytes.data() + i, count, i + count == bytes.size())) return false;
  }
  return stream.isComplete();
}

int main() {
  using namespace CastleTekUpdate;
  size_t size = 77;
  CHECK(parseSize("1", 1, size) && size == 1);
  CHECK(parseSize("2097152", 2097152, size) && size == 2097152);
  CHECK(parseSize(std::to_string(SIZE_MAX).c_str(), SIZE_MAX, size) && size == SIZE_MAX);
  for (const char* value : {"", "0", "01", "+1", "-1", " 1", "1 ", "1\n", "1e3", "true", "1.0", "10000000000000000000000000"}) CHECK(!parseSize(value, 2097152, size));
  CHECK(!parseSize(nullptr, 2097152, size));
  CHECK(!parseSize("2097153", 2097152, size));
  CHECK(!parseSize("1", 0, size));
  uint8_t digest[32], other[32] = {};
  CHECK(parseDigest(std::string(64, '0').c_str(), digest));
  CHECK(equalDigest(digest, other));
  for (size_t i = 0; i < 32; i++) { other[i] = 1; CHECK(!equalDigest(digest, other)); other[i] = 0; }
  CHECK(parseDigest(std::string(64, 'f').c_str(), digest));
  CHECK(digest[0] == 255 && digest[31] == 255);
  for (const auto& value : {std::string(), std::string(63, 'a'), std::string(65, 'a'), std::string(64, 'A'), std::string(64, 'g')}) CHECK(!parseDigest(value.c_str(), digest));
  CHECK(!parseDigest(nullptr, digest));

  for (unsigned variation = 0; variation < 64; variation++) {
    const auto bytes = rawImage(variation);
    for (size_t chunk : {size_t(1),size_t(2),size_t(23),size_t(24),size_t(31),size_t(32),size_t(119),size_t(288),size_t(768),size_t(1460)}) CHECK(accepts(bytes, chunk));
  }
  const auto good = rawImage();
  CHECK(accepts(good, good.size()));
  for (size_t cut = 0; cut < good.size(); cut++) {
    ImageStream partial(good.size());
    CHECK(!partial.feed(0, good.data(), cut, true));
    CHECK(partial.hasFailed() && !partial.isComplete());
  }
  for (size_t offset : {size_t(0),size_t(1),size_t(12),size_t(13),size_t(23),size_t(32),size_t(33),size_t(34),size_t(35),good.size()-33}) {
    auto invalid = good; invalid[offset] ^= 0xff; CHECK(!accepts(invalid, 37));
  }
  auto noHash = good; noHash[23] = 0; noHash.resize(noHash.size() - 32); CHECK(!accepts(noHash));
  auto extra = good; extra.push_back(0); CHECK(!accepts(extra));
  auto hugeSegment = good; for (size_t i = 28; i < 32; i++) hugeSegment[i] = 0xff; CHECK(!accepts(hugeSegment));
  auto shortDescriptor = good; shortDescriptor[28] = 100; shortDescriptor[29] = shortDescriptor[30] = shortDescriptor[31] = 0; CHECK(!accepts(shortDescriptor));
  ImageStream ordered(good.size());
  CHECK(ordered.feed(0, good.data(), 100, false));
  CHECK(!ordered.feed(0, good.data(), 100, false));
  ImageStream gap(good.size()); CHECK(!gap.feed(1, good.data(), 1, false));
  ImageStream overflow(good.size()); CHECK(!overflow.feed(0, good.data(), good.size()+1, true));
  ImageStream nullData(good.size()); CHECK(!nullData.feed(0, nullptr, 1, false));
  ImageStream empty(0); CHECK(!empty.feed(0, nullptr, 0, true));
  ImageStream delayedFinal(good.size());
  CHECK(delayedFinal.feed(0, good.data(), good.size(), false));
  CHECK(!delayedFinal.isComplete());
  CHECK(delayedFinal.feed(good.size(), nullptr, 0, true));
  CHECK(delayedFinal.isComplete());
  CHECK(!delayedFinal.feed(good.size(), nullptr, 0, true));
  CHECK(maximumDurationMs == 300000 && receiveTimeoutSeconds == 15);
  std::cout << "OTA image checks passed: " << checks << '\n';
}
