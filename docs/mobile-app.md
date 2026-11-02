# Mobile app

Chat with your bots, answer their questions, watch their computers and take calls from your phone.

## Install

- iPhone: [App Store](https://apps.apple.com/app/rakazo/id6801531099).
- Android: [download the APK](https://github.com/naouflex/assistant/releases/download/android/atlas.apk).

You can also choose **Get the mobile app** from the account menu in the web or desktop app.

## Sign in

Sign in with your rakazo.com account. To use your own server instead, tap **Use a custom server** on
the sign-in screen and enter its address. For a server on your local network, follow
[Connecting a phone on the same network](./self-host-clients.md#connecting-a-phone-on-the-same-network).

## What you can do

- Chat with bots and groups, attach photos, files or camera shots, and talk instead of typing.
- Answer questions and [approvals](./approvals.md), and save credentials a bot asks for.
- Open a bot's profile to see its **Computer**, **Routines** and settings.
- Take control of a bot's computer, with an on-screen keyboard.
- Call a bot, or answer when a bot calls you. See [Voice and calls](./voice-and-calls.md).
- Connect apps, manage skills, models, voice, approvals, chat apps and your vault from Settings.

The first time you send something, the app asks permission to share it with the AI services your
server uses. Review or withdraw it later in **AI data sharing** in Settings.

## What stays on web and desktop

- Creating or editing [routines](./routines.md). On mobile you can pause, delete and review them, or
  ask the bot in chat to set one up.
- [Teach a task](./skills.md#teach-a-task-by-showing-it).
- [Using your own computer](./desktop-app.md) with bots.

## Notifications

Bots notify you when they finish or need input, controlled per bot with
**When it finishes or needs input** in its settings.

**Push notifications** in Settings turns each kind on or off for the current space: finished work,
questions and approvals, takeover requests and computer problems. A computer problem notice is sent
when a broken computer could not restart by itself after three tries.

Push setup for a self-hosted build:

1. Create a Firebase project, add an Android app with the app's package name, and download
   `google-services.json`. Keep it out of git; pass it to EAS as the `GOOGLE_SERVICES_JSON` file secret.
2. In Firebase, create a service account key for FCM V1 and upload it under the Expo project's
   credentials (Android, FCM V1).
3. Set the EAS `projectId` in the app config so devices get Expo push tokens.
4. Build the APK with `eas build -p android --profile preview` and install it.
5. Set `EXPO_ACCESS_TOKEN` on the API and worker only if enhanced push security is on.

On Android, **Notifications** in Settings also lets you choose which kinds you get, including a live
working status while a bot runs.

## Share to a bot

On Android, share text, images, audio, video, PDFs or files from another app to Atlas and pick the
bot to send them to.
