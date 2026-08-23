import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import ActiveRoomReturn from "@/app/components/ActiveRoomReturn";
import RoomClearNotice from "@/app/components/RoomClearNotice";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "PartyUp",
    template: "%s | PartyUp",
  },
  description: "See what's happening around you. Be part of it.",
  applicationName: "PartyUp",
  openGraph: {
    title: "PartyUp",
    description: "See what's happening around you. Be part of it.",
    siteName: "PartyUp",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "PartyUp",
    description: "See what's happening around you. Be part of it.",
  },
  icons: {
    icon: "/icon.png",
    apple: "/apple-icon.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {children}
        <ActiveRoomReturn />
        <RoomClearNotice />
      </body>
    </html>
  );
}
