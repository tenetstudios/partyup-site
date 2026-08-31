import type { Metadata } from "next";
import { notFound } from "next/navigation";
import BalloonRoomsClient from "./BalloonRoomsClient";

export const metadata: Metadata = {
  title: "Balloon Rooms Prototype",
  robots: { index: false, follow: false },
};

export default function BalloonRoomsDevPage() {
  if (process.env.NODE_ENV !== "development") notFound();

  return <BalloonRoomsClient />;
}
