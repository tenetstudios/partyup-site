import SeriesClient from "./SeriesClient";

export default async function SeriesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <SeriesClient seriesId={id} />;
}
