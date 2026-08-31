"use client";

import { useEffect, useState } from "react";

const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

export function DesktopVersion() {
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const getVersion = window.financeOS?.runtime.getVersion;
    if (!getVersion) return () => {
      active = false;
    };

    void getVersion().then((value) => {
      if (active && VERSION_PATTERN.test(value)) setVersion(value);
    }).catch(() => undefined);

    return () => {
      active = false;
    };
  }, []);

  if (!version) return null;

  return <p aria-label={`Installierte Version ${version}`}>Version {version}</p>;
}
