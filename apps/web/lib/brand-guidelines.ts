export interface BrandGuidelineFonts {
  primary: string;
  secondary: string;
  accent: string;
  headingStyle: string;
}

export interface BrandGuidelineLogoAsset {
  id: string;
  name: string;
  url: string;
  notes: string;
  storagePath?: string;
}

export interface BrandGuidelineAssets {
  secondaryLogos: BrandGuidelineLogoAsset[];
}

export interface BrandGuidelineColors {
  primary: string;
  secondary: string;
  accent: string;
  neutral: string;
  highlight: string;
}

export interface BrandGuidelineVoice {
  voicePrinciples: string;
  tonePrinciples: string;
  elevatorPitch: string;
}

export interface BrandGuidelineImagery {
  notes: string;
}

export interface BrandGuidelinesState {
  fonts: BrandGuidelineFonts;
  assets: BrandGuidelineAssets;
  colors: BrandGuidelineColors;
  voice: BrandGuidelineVoice;
  imagery: BrandGuidelineImagery;
}

export const DEFAULT_BRAND_GUIDELINES: BrandGuidelinesState = {
  fonts: {
    primary: "Poppins",
    secondary: "",
    accent: "",
    headingStyle: "Poppins Bold for headings, Regular for body copy",
  },
  assets: {
    secondaryLogos: [],
  },
  colors: {
    primary: "#215696",
    secondary: "#E8793B",
    accent: "#89CFF0",
    neutral: "#F0F4F8",
    highlight: "#FFFFFF",
  },
  voice: {
    voicePrinciples: "Strategic • Professional • Clear",
    tonePrinciples: "Confident • Approachable • Engaging",
    elevatorPitch: "We build powerful websites and experiences that signpost, showcase, and engage.",
  },
  imagery: {
    notes:
      "Bright, collaborative photography with real teams in action. Use geometric graphic accents sparingly to support key messaging.",
  },
};

export const normaliseGuidelineString = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";

const fallbackString = (value: unknown, fallback: string): string => {
  const normalised = normaliseGuidelineString(value);
  return normalised || fallback;
};

export const parseBrandGuidelines = (
  stored: unknown,
  defaults: BrandGuidelinesState = DEFAULT_BRAND_GUIDELINES,
): BrandGuidelinesState => {
  const source = (stored && typeof stored === "object") ? (stored as any) : {};
  return {
    fonts: {
      primary: fallbackString(source?.fonts?.primary, defaults.fonts.primary),
      secondary: normaliseGuidelineString(source?.fonts?.secondary) || defaults.fonts.secondary,
      accent: normaliseGuidelineString(source?.fonts?.accent) || defaults.fonts.accent,
      headingStyle: fallbackString(source?.fonts?.headingStyle, defaults.fonts.headingStyle),
    },
    assets: {
      secondaryLogos: Array.isArray(source?.assets?.secondaryLogos)
        ? source.assets.secondaryLogos
            .map((logo: any): BrandGuidelineLogoAsset | null => {
              if (!logo || typeof logo !== "object") {
                return null;
              }
              const id = normaliseGuidelineString(logo.id) || normaliseGuidelineString(logo.key) || "";
              const url = normaliseGuidelineString(logo.url);
              if (!id || !url) {
                return null;
              }
              return {
                id,
                name: fallbackString(logo.name, normaliseGuidelineString(logo.fileName) || "Secondary logo"),
                url,
                notes: normaliseGuidelineString(logo.notes),
                storagePath: normaliseGuidelineString(logo.storagePath),
              };
            })
            .filter((logo: BrandGuidelineLogoAsset | null): logo is BrandGuidelineLogoAsset => Boolean(logo))
        : defaults.assets.secondaryLogos,
    },
    colors: {
      primary: String(source?.colors?.primary || defaults.colors.primary),
      secondary: String(source?.colors?.secondary || defaults.colors.secondary),
      accent: String(source?.colors?.accent || defaults.colors.accent),
      neutral: String(source?.colors?.neutral || defaults.colors.neutral),
      highlight: String(source?.colors?.highlight || defaults.colors.highlight),
    },
    voice: {
      voicePrinciples: fallbackString(source?.voice?.voicePrinciples, defaults.voice.voicePrinciples),
      tonePrinciples: fallbackString(source?.voice?.tonePrinciples, defaults.voice.tonePrinciples),
      elevatorPitch: fallbackString(source?.voice?.elevatorPitch, defaults.voice.elevatorPitch),
    },
    imagery: {
      notes: fallbackString(source?.imagery?.notes, defaults.imagery.notes),
    },
  };
};

export const sanitiseBrandGuidelines = (
  value: BrandGuidelinesState,
): BrandGuidelinesState => ({
  fonts: {
    primary: normaliseGuidelineString(value.fonts.primary),
    secondary: normaliseGuidelineString(value.fonts.secondary),
    accent: normaliseGuidelineString(value.fonts.accent),
    headingStyle: normaliseGuidelineString(value.fonts.headingStyle),
  },
  assets: {
    secondaryLogos: Array.isArray(value.assets.secondaryLogos)
      ? value.assets.secondaryLogos
          .map((logo) => ({
            id: normaliseGuidelineString(logo.id),
            name: normaliseGuidelineString(logo.name),
            url: normaliseGuidelineString(logo.url),
            notes: normaliseGuidelineString(logo.notes),
            storagePath: normaliseGuidelineString(logo.storagePath),
          }))
          .filter((logo) => Boolean(logo.id && logo.url))
      : [],
  },
  colors: {
    primary: normaliseGuidelineString(value.colors.primary) || DEFAULT_BRAND_GUIDELINES.colors.primary,
    secondary: normaliseGuidelineString(value.colors.secondary) || DEFAULT_BRAND_GUIDELINES.colors.secondary,
    accent: normaliseGuidelineString(value.colors.accent) || DEFAULT_BRAND_GUIDELINES.colors.accent,
    neutral: normaliseGuidelineString(value.colors.neutral) || DEFAULT_BRAND_GUIDELINES.colors.neutral,
    highlight: normaliseGuidelineString(value.colors.highlight) || DEFAULT_BRAND_GUIDELINES.colors.highlight,
  },
  voice: {
    voicePrinciples: normaliseGuidelineString(value.voice.voicePrinciples),
    tonePrinciples: normaliseGuidelineString(value.voice.tonePrinciples),
    elevatorPitch: normaliseGuidelineString(value.voice.elevatorPitch),
  },
  imagery: {
    notes: normaliseGuidelineString(value.imagery.notes),
  },
});
