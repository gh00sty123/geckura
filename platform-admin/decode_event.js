const anchor = require("@coral-xyz/anchor");
const IDL = require("./src/lib/idl.json");

const base64Log = "0ug+etcmBv4Qd+IvyUvs/wis/uuT9BhDGH9EH6us54aIUdgkGc/R3zoqJ8in4p39iWREPaGTyzKXxKnQ1H/avFUSihIeUQ0QAD8AAAAAAAAAAQAAAAAAAAAQAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACA8PoCAAAAABU1OmoAAAAA";

const coder = new anchor.BorshEventCoder(IDL);
// Remove Anchor event discriminator (first 8 bytes of decoded base64)
const buf = Buffer.from(base64Log, "base64");
const event = coder.decode(buf);
console.log("Decoded Event:", JSON.stringify(event, null, 2));
