/* Minimal GIF89a encoder — vanilla JS, no libraries */
(function (w) {
  "use strict";
  function encodeGif(frames, width, height, delayCs) {
    var pal = [];
    function q(v) {
      return Math.round(v / 51);
    }
    function idx(r, g, b) {
      return q(r) * 36 + q(g) * 6 + q(b);
    }
    var i;
    for (i = 0; i < 216; i++) {
      pal.push(((i / 36) | 0) * 51, (((i / 6) | 0) % 6) * 51, (i % 6) * 51);
    }
    while (pal.length < 256 * 3) pal.push(0, 0, 0);
    var out = [];
    function u8(n) {
      out.push(n & 255);
    }
    function u16(n) {
      out.push(n & 255, (n >> 8) & 255);
    }
    function bytes(s) {
      for (var k = 0; k < s.length; k++) out.push(s.charCodeAt(k));
    }
    bytes("GIF89a");
    u16(width);
    u16(height);
    u8(0xf7);
    u8(0);
    u8(0);
    for (i = 0; i < pal.length; i++) u8(pal[i]);
    u8(0x21);
    u8(0xff);
    u8(11);
    bytes("NETSCAPE2.0");
    u8(3);
    u8(1);
    u16(0);
    u8(0);
    for (var f = 0; f < frames.length; f++) {
      var px = frames[f];
      u8(0x21);
      u8(0xf9);
      u8(4);
      u8(4);
      u16(delayCs);
      u8(0);
      u8(0);
      u8(0x2c);
      u16(0);
      u16(0);
      u16(width);
      u16(height);
      u8(0);
      var idxBuf = new Uint8Array(width * height);
      for (i = 0; i < width * height; i++) {
        var o = i * 4;
        idxBuf[i] = idx(px[o], px[o + 1], px[o + 2]);
      }
      var packed = lzw(idxBuf, 8);
      u8(8);
      var off = 0;
      while (off < packed.length) {
        var n = Math.min(255, packed.length - off);
        u8(n);
        for (i = 0; i < n; i++) u8(packed[off + i]);
        off += n;
      }
      u8(0);
    }
    u8(0x3b);
    return new Uint8Array(out);
  }
  function lzw(indexes, minSize) {
    var clear = 1 << minSize;
    var end = clear + 1;
    var codeSize = minSize + 1;
    var nextCode = end + 1;
    var dict = {};
    var bitBuf = 0;
    var bitN = 0;
    var bytes = [];
    function emit(code, size) {
      bitBuf |= code << bitN;
      bitN += size;
      while (bitN >= 8) {
        bytes.push(bitBuf & 255);
        bitBuf >>= 8;
        bitN -= 8;
      }
    }
    function reset() {
      dict = {};
      codeSize = minSize + 1;
      nextCode = end + 1;
    }
    emit(clear, codeSize);
    var w = String.fromCharCode(indexes[0]);
    for (var i = 1; i < indexes.length; i++) {
      var c = String.fromCharCode(indexes[i]);
      var wc = w + c;
      if (dict[wc] != null) w = wc;
      else {
        emit(w.length === 1 ? w.charCodeAt(0) : dict[w], codeSize);
        if (nextCode < 4096) {
          dict[wc] = nextCode++;
          if (nextCode === 1 << codeSize && codeSize < 12) codeSize++;
        } else {
          emit(clear, codeSize);
          reset();
        }
        w = c;
      }
    }
    emit(w.length === 1 ? w.charCodeAt(0) : dict[w], codeSize);
    emit(end, codeSize);
    if (bitN > 0) bytes.push(bitBuf & 255);
    return bytes;
  }
  w.encodeGif = encodeGif;
})(window);
