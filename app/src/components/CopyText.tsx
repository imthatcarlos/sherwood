"use client";

import { useCallback } from "react";

/**
 * Inline clickable span that copies a value to clipboard.
 * No button styling, no feedback text — just cursor pointer.
 */
export default function CopyText({
  children,
  copyValue,
  className = "",
}: {
  children: React.ReactNode;
  copyValue: string;
  className?: string;
}) {
  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(copyValue);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = copyValue;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
    }
  }, [copyValue]);

  return (
    <span
      onClick={handleCopy}
      className={`cursor-pointer transition-opacity hover:opacity-80 ${className}`}
      title="Click to copy"
    >
      {children}
    </span>
  );
}
