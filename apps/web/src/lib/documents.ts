export type DocumentResource = {
  id: string;
  filename: string;
  content_type: "application/pdf" | "image/png" | "image/jpeg";
  size_bytes: number;
  sha256: string;
  status: "stored";
  created_at: string;
  download_url: string;
};

export type DocumentResponse = {
  data: DocumentResource;
};

export type DocumentListResponse = {
  data: DocumentResource[];
  meta: {
    has_next: boolean;
    next_cursor: string | null;
  };
};

export type ApiErrorResponse = {
  error: {
    code: string;
    message: string;
  };
};
