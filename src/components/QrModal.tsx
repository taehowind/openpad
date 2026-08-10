"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { Check, Copy, Download, X } from "lucide-react";

type QrModalProps = {
  url: string;
  code?: string;
  title?: string;
  subtitle?: string;
  onClose: () => void;
  onCopyLink?: () => void;
};

export function QrModal({ url, code, title, subtitle, onClose, onCopyLink }: QrModalProps) {
  const [src, setSrc] = useState("");
  const [failed, setFailed] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let active = true;
    QRCode.toDataURL(url, { width: 640, margin: 2, errorCorrectionLevel: "M", color: { dark: "#100f0d", light: "#ffffff" } })
      .then((data) => { if (active) setSrc(data); })
      .catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [url]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function copyUrl() {
    if (onCopyLink) { onCopyLink(); }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  }

  return (
    <div className="modal-backdrop qr-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="modal-card qr-modal" role="dialog" aria-modal="true" aria-labelledby="qr-title">
        <button type="button" className="modal-close" aria-label="공유 창 닫기" onClick={onClose}><X size={18} /></button>
        <span className="kicker">SHARE</span>
        <h2 id="qr-title">{title ?? "공유 QR 코드"}</h2>
        <p>{subtitle ?? "수강생이 휴대폰 카메라로 스캔하면 바로 보드에 입장합니다."}</p>
        <div className="qr-frame">
          {failed ? (
            <span className="qr-error">QR 코드를 만들지 못했습니다.</span>
          ) : src ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={src} alt="공유 QR 코드" width={272} height={272} />
          ) : (
            <span className="spinner" />
          )}
        </div>
        {code && <p className="qr-code-caption">참여 코드 <strong>{code}</strong></p>}
        <div className="qr-url">
          <span>{url}</span>
          <button type="button" onClick={() => void copyUrl()} aria-label="링크 복사">{copied ? <><Check size={15} /> 복사됨</> : <><Copy size={15} /> 복사</>}</button>
        </div>
        <div className="qr-actions">
          {src && <a className="primary-button compact" href={src} download={`aistudy-${code ?? "share"}.png`}><Download size={16} /> QR 이미지 저장</a>}
        </div>
      </div>
    </div>
  );
}
