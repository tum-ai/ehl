import { ImageResponse } from "next/og";

export const runtime = "edge";

export async function GET() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(135deg, #0B0B1A 0%, #1A1A3A 50%, #0B0B1A 100%)",
          fontFamily: "sans-serif",
        }}
      >
        {/* Glow effects */}
        <div
          style={{
            position: "absolute",
            top: -100,
            left: -100,
            width: 400,
            height: 400,
            borderRadius: "50%",
            background: "radial-gradient(circle, rgba(155,89,182,0.15), transparent 70%)",
          }}
        />
        <div
          style={{
            position: "absolute",
            bottom: -100,
            right: -100,
            width: 400,
            height: 400,
            borderRadius: "50%",
            background: "radial-gradient(circle, rgba(232,184,75,0.1), transparent 70%)",
          }}
        />

        {/* EHL text */}
        <div
          style={{
            display: "flex",
            fontSize: 120,
            fontWeight: 900,
            letterSpacing: "0.15em",
            color: "#E8B84B",
            marginBottom: 20,
          }}
        >
          EHL
        </div>

        {/* Subtitle */}
        <div
          style={{
            display: "flex",
            fontSize: 28,
            fontWeight: 700,
            letterSpacing: "0.3em",
            color: "rgba(229,228,226,0.6)",
            textTransform: "uppercase",
          }}
        >
          European Hackathon League
        </div>

        {/* Divider */}
        <div
          style={{
            width: 80,
            height: 2,
            background: "linear-gradient(to right, transparent, rgba(155,89,182,0.5), transparent)",
            margin: "30px 0",
          }}
        />

        {/* Tagline */}
        <div
          style={{
            display: "flex",
            fontSize: 36,
            fontWeight: 700,
            color: "#E5E4E2",
          }}
        >
          {"Europe's first competitive hackathon league"}
        </div>

        {/* Cities */}
        <div
          style={{
            display: "flex",
            fontSize: 16,
            letterSpacing: "0.25em",
            color: "rgba(229,228,226,0.4)",
            textTransform: "uppercase",
            marginTop: 24,
          }}
        >
          Munich · Paris · Zurich
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
    }
  );
}
