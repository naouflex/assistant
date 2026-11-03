import type { ProcessEvent } from "@atlas/adapter-kit";
import type { HostComputerEnvironment, HostComputerRequest } from "./host-computer-protocol.js";
import type { HostScreenObservation } from "./host-screen.js";
import type {
  PhoneNotificationResult,
  PhoneScreen,
  PhoneShellResult,
  UserDeviceKind,
} from "./phone-protocol.js";
import type { UserDevice, UserDeviceGateway } from "./user-device-protocol.js";

export const USER_DEVICE_EMULATOR_OUTPUT = "fixture-mac\n";
export const USER_DEVICE_EMULATOR_PHONE_OUTPUT = "fixture-phone\n";

/**
 * Deterministic, offline stand-in for a connected desktop: every user has one, every command
 * prints USER_DEVICE_EMULATOR_OUTPUT, and every app shows one empty window. Records what it was
 * asked to run. A phone is connected only when constructed with `{ phone: true }`.
 */
export class UserDeviceEmulator implements UserDeviceGateway {
  readonly requests: Array<{ userId: string; request: HostComputerRequest }> = [];

  readonly #phone: boolean;

  constructor(options: { phone?: boolean } = {}) {
    this.#phone = options.phone ?? false;
  }

  async connected(_userId: string, kind: UserDeviceKind = "computer"): Promise<UserDevice | null> {
    if (kind === "phone")
      return this.#phone
        ? { deviceId: "emulated-phone", name: "Fixture Pixel", platform: "android" }
        : null;
    return { deviceId: "emulated-device", name: "Fixture Mac", platform: "darwin" };
  }

  async pairedSince(_userId: string, kind: UserDeviceKind = "computer"): Promise<Date | null> {
    return kind === "phone" && !this.#phone ? null : new Date(0);
  }

  async *request<T>(
    userId: string,
    request: HostComputerRequest,
    _signal: AbortSignal,
  ): AsyncIterable<T> {
    this.requests.push({ userId, request });
    if (request.method === "environment") {
      const environment: HostComputerEnvironment = {
        platform: "darwin",
        home: "/Users/fixture",
        shell: "/bin/zsh",
      };
      yield environment as T;
      return;
    }
    if (request.method === "execute") {
      const events: ProcessEvent[] = [
        { type: "stdout", data: USER_DEVICE_EMULATOR_OUTPUT },
        { type: "exit", code: 0 },
      ];
      for (const event of events) yield event as T;
      return;
    }
    if (request.method === "screenObserve" || request.method === "screenAct") {
      const observation: HostScreenObservation = {
        app: request.app,
        title: "Untitled",
        tree: '- [0] AXWindow "Untitled"\n  - [1] AXTextArea',
      };
      yield (
        request.method === "screenAct"
          ? { completed: request.actions.length, observation }
          : observation
      ) as T;
      return;
    }
    if (request.method === "phone") {
      if (request.action.op === "shell") {
        const result: PhoneShellResult = {
          exitCode: 0,
          stdout: USER_DEVICE_EMULATOR_PHONE_OUTPUT,
          stderr: "",
          runner: request.action.termux
            ? "termux"
            : request.action.privileged
              ? "privileged"
              : "sh",
        };
        yield result as T;
        return;
      }
      if (request.action.op === "notifications") {
        const result: PhoneNotificationResult =
          request.action.verb === "list"
            ? {
                notifications: [
                  {
                    key: "n1",
                    package: "com.example.mail",
                    app: "Mail",
                    title: "Hi",
                    text: "There",
                    when: 0,
                    ongoing: false,
                    actions: ["Reply"],
                  },
                ],
              }
            : {
                done:
                  request.action.verb === "open"
                    ? "opened"
                    : request.action.verb === "dismiss"
                      ? "dismissed"
                      : "activated",
              };
        yield result as T;
        return;
      }
      const screen: PhoneScreen = {
        package: "com.android.launcher",
        width: 576,
        height: 1280,
        tree: '[0] FrameLayout (0,0,576,1280)\n[1] TextView "Settings" (40,200,160,260)',
        ...(request.action.op === "screenshot"
          ? { image: { mimeType: "image/png", data: "iVBORw0KGgo=", width: 576, height: 1280 } }
          : {}),
      };
      yield screen as T;
      return;
    }
    yield null as T;
  }
}
