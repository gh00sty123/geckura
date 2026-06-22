"use client";

import { createContext, useContext, useState, useCallback, type ReactNode } from "react";

export type ProjectBrandingValue = {
  name: string;
  logoUrl: string | null;
  themeColor: string | null;
  navbarColor: string | null;
  textColor: string | null;
  nothingRewardImage?: string | null;
  twitterUsername?: string | null;
};

const defaultBrand: ProjectBrandingValue = { name: "Geckura", logoUrl: null, themeColor: null, navbarColor: null, textColor: null, nothingRewardImage: null, twitterUsername: null };

interface BrandingContextValue extends ProjectBrandingValue {
  setBranding(b: ProjectBrandingValue): void;
}

export const ProjectBrandingContext = createContext<BrandingContextValue>({
  ...defaultBrand,
  setBranding: () => {},
});
ProjectBrandingContext.displayName = "ProjectBranding";

/** Provider wraps `Shell` at layout level so every page inherits it. */
export function ProjectBrandingProvider({ children }: { children: ReactNode }) {
  // Single state lives here so any child can call setBranding().
  const [brand, _setBrand] = useState<ProjectBrandingValue>(defaultBrand);
  const setBranding = useCallback((b: ProjectBrandingValue) => _setBrand(b), []);

  return (
    <ProjectBrandingContext.Provider value={{ ...brand, setBranding }}>
      {children}
    </ProjectBrandingContext.Provider>
  );
}

/** Read the current brand anywhere inside the provider tree. */
export function useProjectBranding(): ProjectBrandingValue {
  const { name, logoUrl, themeColor, navbarColor, textColor, nothingRewardImage, twitterUsername } = useContext(ProjectBrandingContext);
  return { name, logoUrl, themeColor, navbarColor, textColor, nothingRewardImage, twitterUsername };
}

/** Update the brand from a page, effect, or callback. */
export function useSetProjectBranding(): (b: ProjectBrandingValue) => void {
  const { setBranding } = useContext(ProjectBrandingContext);
  return setBranding;
}
