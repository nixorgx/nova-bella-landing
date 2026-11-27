"use client";

import { useEffect, useRef, useState } from "react";
import { Modal } from "@/components/ui/Modal";

interface Props {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onDetected: (code: string) => void;
}

type Status = "starting" | "scanning" | "error";

const ERROR_MESSAGES: Readonly<Record<string, string>> = {
  NotAllowedError: "No hay permiso para usar la cámara. Habilítela en el navegador o escriba el código a mano.",
  SecurityError: "No hay permiso para usar la cámara. Habilítela en el navegador o escriba el código a mano.",
  NotFoundError: "Este dispositivo no tiene cámara disponible. Use un lector USB o escriba el código.",
  NotReadableError: "La cámara está en uso por otra aplicación. Ciérrela e intente de nuevo.",
};
const INSECURE_MESSAGE = "La cámara solo funciona en una conexión segura (HTTPS). Escriba el código a mano.";
const GENERIC_MESSAGE = "No se pudo iniciar la cámara. Escriba el código a mano.";

export function cameraErrorMessage(error: unknown): string {
  const name = (error as { name?: string } | null)?.name ?? "";
  return ERROR_MESSAGES[name] ?? GENERIC_MESSAGE;
}

/** Phone camera scanner dialog (@zxing/browser, loaded only when it opens). */
export function CameraScanner({ open, onClose, onDetected }: Props) {
  return (
    <Modal open={open} onClose={onClose} title="Escanear con la cámara">
      <CameraView onDetected={onDetected} />
    </Modal>
  );
}

/** Mounted only while the dialog is open, so every opening starts from a clean state. */
function CameraView({ onDetected }: { onDetected: (code: string) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const detectedRef = useRef(onDetected);
  const [status, setStatus] = useState<Status>("starting");
  const [message, setMessage] = useState("");

  useEffect(() => {
    detectedRef.current = onDetected;
  });

  useEffect(() => {
    let stopped = false;
    let stop: (() => void) | undefined;

    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setStatus("error");
        setMessage(INSECURE_MESSAGE);
        return;
      }
      try {
        const { BrowserMultiFormatReader } = await import("@zxing/browser");
        const reader = new BrowserMultiFormatReader();
        const controls = await reader.decodeFromConstraints(
          { video: { facingMode: { ideal: "environment" } }, audio: false },
          videoRef.current ?? undefined,
          (result) => {
            if (!result || stopped) return;
            stopped = true;
            controls.stop();
            detectedRef.current(result.getText());
          },
        );
        stop = () => controls.stop();
        if (stopped) controls.stop();
        else setStatus("scanning");
      } catch (error) {
        if (stopped) return;
        setStatus("error");
        setMessage(cameraErrorMessage(error));
      }
    }
    void start();

    return () => {
      stopped = true;
      stop?.();
    };
  }, []);

  return (
      <div className="camera">
        {status === "error" ? (
          <p className="notice notice--error" role="alert">
            {message}
          </p>
        ) : (
          <div className="camera__frame">
            <video ref={videoRef} muted playsInline aria-label="Vista de la cámara" />
            <span className="camera__guide" aria-hidden="true" />
          </div>
        )}
        <p className="field__hint" role="status">
          {status === "starting" ? "Iniciando cámara…" : null}
          {status === "scanning" ? "Apunte al código de barras o QR de la caja." : null}
        </p>
      </div>
  );
}
