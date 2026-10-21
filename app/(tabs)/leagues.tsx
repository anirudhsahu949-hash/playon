import { Redirect } from "expo-router";

// Center "Leagues" tab button navigates to /playon-pro directly.
// This redirect is just a safety net if the route is reached another way.
export default function LeaguesTabRedirect() {
  return <Redirect href="/(playon-pro)" />;
}