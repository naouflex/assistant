/** @jsxRuntime automatic */
import type { TransactionalEmail } from "@atlas/adapter-kit";
import { ANDROID_APK_URL } from "@atlas/contracts";
import { displayName } from "@atlas/core";
import { Link, Text } from "react-email";
import { linkStyle, message } from "./email.js";

const APPS = [
  ["Android", ANDROID_APK_URL],
  ["Mac", "https://rakazo.com/api/download?platform=mac"],
  ["Windows", "https://rakazo.com/api/download?platform=windows"],
  ["Linux", "https://rakazo.com/api/download?platform=linux"],
] as const;

export function welcomeEmail(
  user: { email: string; name: string },
  unsubscribeUrl: string,
): Promise<TransactionalEmail> {
  return message(
    user.email,
    "Welcome to Atlas",
    <>
      <Text>Hi {displayName(user.name, "there")},</Text>
      <Text>Thanks for signing up for Atlas.</Text>
      <Text>
        Atlas also has apps for{" "}
        {APPS.map(([name, href], index) => (
          <span key={name}>
            {index === APPS.length - 1 ? "and " : ""}
            <Link href={href} style={linkStyle}>
              {name}
            </Link>
            {index === APPS.length - 1 ? "." : ", "}
          </span>
        ))}
      </Text>
      <Text>
        Questions or ideas?{" "}
        <Link href="https://discord.gg/RWwKa2Sn7h" style={linkStyle}>
          Join us on Discord
        </Link>
        .
      </Text>
      <Text>
        Atlas is open source. If you like it,{" "}
        <Link href="https://github.com/naouflex/assistant" style={linkStyle}>
          a star on GitHub
        </Link>{" "}
        helps others find it.
      </Text>
      <Text>
        Want to run it on your own servers?{" "}
        <Link
          href="https://github.com/naouflex/assistant/blob/main/docs/self-host.md"
          style={linkStyle}
        >
          Self-host Atlas
        </Link>
        .
      </Text>
      <Text>Have any questions? Reply to this email.</Text>
      <Text>Elie</Text>
    </>,
    unsubscribeUrl,
  );
}
