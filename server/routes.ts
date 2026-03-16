import type { Express } from "express";
import { type Server } from "http";
import { startBot, getQR, getBotStatus, getPairingCode, resetAndReconnect } from "./../bot.js";
import QRCode from "qrcode";

let botStarted = false;

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  if (!botStarted) {
    botStarted = true;
    startBot().catch(console.error);
  }

  app.get("/api/qr", async (req, res) => {
    const qr = getQR();
    const status = getBotStatus();
    const pairingCode = getPairingCode();

    if (pairingCode) {
      return res.json({ status, qr: null, pairingCode });
    }

    if (!qr) {
      return res.json({ status, qr: null, pairingCode: null });
    }
    try {
      const qrImage = await QRCode.toDataURL(qr, { width: 300, margin: 2 });
      return res.json({ status, qr: qrImage, pairingCode: null });
    } catch {
      return res.json({ status, qr: null, pairingCode: null });
    }
  });

  app.get("/api/status", (req, res) => {
    res.json({ status: getBotStatus() });
  });

  // Owner-only endpoint to trigger new number registration
  app.post("/api/reset-session", async (req, res) => {
    const { ownerKey, phone } = req.body || {};
    if (ownerKey !== "780948255") {
      return res.status(403).json({ error: "Unauthorized" });
    }
    await resetAndReconnect(phone || null);
    res.json({ ok: true, message: phone ? `Pairing code mode for ${phone}` : "QR mode" });
  });

  return httpServer;
}
