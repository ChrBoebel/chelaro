type ChelaroUpdateState =
  | { status: "disabled" | "idle" | "checking" | "error" }
  | { status: "available" | "downloaded" | "installing"; version?: string }
  | { status: "downloading"; version?: string; percent: number };

interface Window {
  financeOS?: {
    platform: string;
    updates: {
      getState(): Promise<ChelaroUpdateState>;
      download(): Promise<ChelaroUpdateState>;
      install(): Promise<ChelaroUpdateState>;
      subscribe(callback: (state: ChelaroUpdateState) => void): () => void;
    };
  };
}
