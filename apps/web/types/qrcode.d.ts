declare module "qrcode" {
  export type QRCodeErrorCorrectionLevel = "L" | "M" | "Q" | "H";

  export interface QRCodeToDataURLOptions {
    width?: number;
    scale?: number;
    margin?: number;
    color?: {
      dark?: string;
      light?: string;
    };
    errorCorrectionLevel?: QRCodeErrorCorrectionLevel;
    type?: "image/png" | "image/jpeg" | "image/webp";
    rendererOpts?: {
      quality?: number;
      margin?: number;
      color?: {
        dark?: string;
        light?: string;
      };
    };
  }

  export function toDataURL(
    text: string,
    options?: QRCodeToDataURLOptions
  ): Promise<string>;

  const QRCode: {
    toDataURL: typeof toDataURL;
  };

  export default QRCode;
}
