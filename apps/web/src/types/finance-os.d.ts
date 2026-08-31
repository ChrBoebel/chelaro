type ChelaroUpdateState =
  | { status: "disabled" | "idle" | "checking" }
  | { status: "available" | "downloaded"; version: string }
  | { status: "downloading"; version: string; percent: number }
  | { status: "error"; stage: "check" | "download" | "open"; version?: string };

interface Window {
  financeOS?: {
    platform: string;
    updates: {
      getState(): Promise<ChelaroUpdateState>;
      check(): Promise<ChelaroUpdateState>;
      download(): Promise<ChelaroUpdateState>;
      openInstaller(): Promise<ChelaroUpdateState>;
      openReleasePage(): Promise<ChelaroUpdateState>;
      subscribe(callback: (state: ChelaroUpdateState) => void): () => void;
    };
  };
}
