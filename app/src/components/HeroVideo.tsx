"use client";

import { useEffect, useRef, useState } from "react";

export default function HeroVideo() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    // Video may have loaded before hydration — check immediately
    if (videoRef.current && videoRef.current.readyState >= 3) {
      setLoaded(true);
    }
  }, []);

  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width: "100%",
        height: "100vh",
        overflow: "hidden",
        zIndex: -1,
      }}
    >
      <video
        ref={videoRef}
        autoPlay
        loop
        muted
        playsInline
        onLoadedData={() => setLoaded(true)}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          opacity: loaded ? 1 : 0,
          transition: "opacity 1.2s ease-in",
        }}
      >
        <source src="/hero-bg.mp4" type="video/mp4" />
      </video>
      {/* Gradient overlay: readable text + fades to page bg at bottom */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "linear-gradient(to bottom, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.6) 50%, rgba(5,5,5,1) 100%)",
        }}
      />
    </div>
  );
}
