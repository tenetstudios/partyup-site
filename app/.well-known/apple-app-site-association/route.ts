const teamIdPattern = /^[A-Z0-9]{10}$/;

export const dynamic = "force-dynamic";

export function GET() {
  const teamId = process.env.APPLE_TEAM_ID?.trim().toUpperCase() ?? "";

  if (!teamIdPattern.test(teamId)) {
    return new Response("APPLE_TEAM_ID is not configured correctly.\n", {
      status: 503,
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "text/plain; charset=utf-8",
      },
    });
  }

  return Response.json(
    {
      applinks: {
        details: [
          {
            appIDs: [`${teamId}.io.partyup.app`],
            components: [
              { "/": "/join/*", comment: "PartyUp room entry links" },
              { "/": "/room/*", comment: "PartyUp rooms, Missions, Wild, and trivia" },
              { "/": "/n/*", comment: "PartyUp Live Node claims" },
              { "/": "/recap/*", comment: "PartyUp event recaps" },
              { "/": "/series/*", comment: "PartyUp event series" },
            ],
          },
        ],
      },
    },
    {
      headers: {
        "Cache-Control": "public, max-age=300",
        "Content-Type": "application/json",
      },
    },
  );
}
