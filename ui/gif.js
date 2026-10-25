/* GIF89a encoder — vanilla JS, no libraries.
 *
 * The LZW stage follows the well-known compress/GIFCOMPR ordering: a code is
 * written with the *current* code width and only then is the width bumped when
 * the dictionary outgrows it. Bumping earlier (the obvious way) desyncs every
 * decoder once frames contain more than a handful of colours, which is what
 * made earlier exports unreadable.
 */
(function (w) {
  "use strict";

  var PALETTE_STEPS = 6; // 6 x 6 x 6 = 216 colours
  var BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

  function buildPalette() {
    var pal = [];
    for (var r = 0; r < PALETTE_STEPS; r++) {
      for (var g = 0; g < PALETTE_STEPS; g++) {
        for (var b = 0; b < PALETTE_STEPS; b++) {
          pal.push(Math.round((r * 255) / (PALETTE_STEPS - 1)));
          pal.push(Math.round((g * 255) / (PALETTE_STEPS - 1)));
          pal.push(Math.round((b * 255) / (PALETTE_STEPS - 1)));
        }
      }
    }
    while (pal.length < 256 * 3) pal.push(0, 0, 0);
    return pal;
  }

  function quantise(rgba, width, height) {
    var idx = new Uint8Array(width * height);
    var step = 255 / (PALETTE_STEPS - 1);
    var maxLevel = PALETTE_STEPS - 1;
    for (var y = 0; y < height; y++) {
      var row = (y & 3) * 4;
      for (var x = 0; x < width; x++) {
        var o = (y * width + x) * 4;
        // 4x4 ordered dithering hides the 216-colour banding.
        var d = (BAYER[row + (x & 3)] / 15 - 0.5) * step;
        var r = clampLevel((rgba[o] + d) / step, maxLevel);
        var g = clampLevel((rgba[o + 1] + d) / step, maxLevel);
        var b = clampLevel((rgba[o + 2] + d) / step, maxLevel);
        idx[y * width + x] = r * 36 + g * 6 + b;
      }
    }
    return idx;
  }

  function clampLevel(v, maxLevel) {
    var n = Math.round(v);
    if (n < 0) return 0;
    if (n > maxLevel) return maxLevel;
    return n;
  }

  /// compress-style LZW. Returns the packed sub-block payload.
  function lzw(indexes, minSize) {
    var clearCode = 1 << minSize;
    var eofCode = clearCode + 1;
    var nBits = minSize + 1;
    var maxcode = (1 << nBits) - 1;
    var freeEnt = clearCode + 2;
    var clearFlag = false;
    var bitBuf = 0;
    var bitN = 0;
    var bytes = [];

    function output(code) {
      bitBuf |= code << bitN;
      bitN += nBits;
      while (bitN >= 8) {
        bytes.push(bitBuf & 0xff);
        bitBuf >>= 8;
        bitN -= 8;
      }
      if (clearFlag) {
        nBits = minSize + 1;
        maxcode = (1 << nBits) - 1;
        clearFlag = false;
      } else if (freeEnt > maxcode) {
        nBits++;
        maxcode = nBits === 12 ? 4096 : (1 << nBits) - 1;
      }
    }

    function clearBlock() {
      freeEnt = clearCode + 2;
      clearFlag = true;
      output(clearCode);
    }

    output(clearCode);
    if (!indexes.length) {
      output(eofCode);
      if (bitN > 0) bytes.push(bitBuf & 0xff);
      return bytes;
    }

    var table = new Map();
    var ent = indexes[0];
    for (var i = 1; i < indexes.length; i++) {
      var c = indexes[i];
      var key = ent * 256 + c;
      var hit = table.get(key);
      if (hit !== undefined) {
        ent = hit;
        continue;
      }
      output(ent);
      if (freeEnt < 4096) {
        table.set(key, freeEnt++);
      } else {
        clearBlock();
        table.clear();
      }
      ent = c;
    }
    output(ent);
    output(eofCode);
    if (bitN > 0) bytes.push(bitBuf & 0xff);
    return bytes;
  }

  /**
   * frames: array of RGBA Uint8ClampedArray (ImageData.data), all width*height*4.
   * delayCs: frame delay in hundredths of a second (8 fps => 12 or 13).
   */
  function encodeGif(frames, width, height, delayCs) {
    width = Math.max(1, width | 0);
    height = Math.max(1, height | 0);
    var warmup = quantise(frames[0], width, height);
    var minSize = 8;
    while ((1 << minSize) < 256) minSize++;

    var out = [];
    function u8(n) {
      out.push(n & 255);
    }
    function u16(n) {
      out.push(n & 255, (n >> 8) & 255);
    }
    function str(s) {
      for (var k = 0; k < s.length; k++) out.push(s.charCodeAt(k) & 255);
    }
    function blocks(packed) {
      var off = 0;
      while (off < packed.length) {
        var n = Math.min(255, packed.length - off);
        u8(n);
        for (var i = 0; i < n; i++) out.push(packed[off + i]);
        off += n;
      }
      u8(0);
    }

    str("GIF89a");
    u16(width);
    u16(height);
    u8(0xf7); // global colour table, 8 bits per channel, 256 entries
    u8(0); // background colour index
    u8(0); // pixel aspect ratio
    var pal = buildPalette();
    for (var p = 0; p < pal.length; p++) u8(pal[p]);

    // loop forever
    u8(0x21);
    u8(0xff);
    u8(11);
    str("NETSCAPE2.0");
    u8(3);
    u8(1);
    u16(0);
    u8(0);

    var delay = Math.max(2, Math.round(delayCs || 12));
    for (var f = 0; f < frames.length; f++) {
      var idx = f === 0 ? warmup : quantise(frames[f], width, height);
      // graphic control extension: disposal "do not dispose", no transparency
      u8(0x21);
      u8(0xf9);
      u8(4);
      u8(0x04);
      u16(delay);
      u8(0);
      u8(0);
      // image descriptor
      u8(0x2c);
      u16(0);
      u16(0);
      u16(width);
      u16(height);
      u8(0);
      u8(minSize);
      blocks(lzw(idx, minSize));
    }

    u8(0x3b); // trailer
    return new Uint8Array(out);
  }

  w.encodeGif = encodeGif;
})(window);
