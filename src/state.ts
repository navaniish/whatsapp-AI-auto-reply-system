// Shared singleton state — imported by both index.ts and whatsappClient.ts
// Avoids circular dependency between server routes and WhatsApp client.

export type WhatsAppStatus = 'disconnected' | 'waiting_qr' | 'connected';

export const state = {
  qrString: null as string | null,
  status: 'disconnected' as WhatsAppStatus,
};

export function setQR(qr: string | null): void {
  state.qrString = qr;
  if (qr) state.status = 'waiting_qr';
}

export function setStatus(s: WhatsAppStatus): void {
  state.status = s;
  if (s === 'connected') state.qrString = null;
}
