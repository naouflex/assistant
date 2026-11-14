import type { AdapterContext, CommandRequest, ComputerRef, ProcessEvent } from "@atlas/adapter-kit";
import { FakeSandboxProvider } from "@atlas/adapters";

/** A model must not receive successful shell results for commands the fixture never ran. */
export class EvalSandboxProvider extends FakeSandboxProvider {
  readonly harnessIssues: string[] = [];
  /** In a replay with a simulated world, answers the agent's own shell commands too. */
  simulate?: (argv: string[]) => Promise<string>;

  override async *execute(
    computer: ComputerRef,
    request: CommandRequest,
    context: AdapterContext,
  ): AsyncIterable<ProcessEvent> {
    if (request.argv[3] === "atlas-background-launch" && this.simulate) {
      const output = await this.simulate([request.argv.at(-1) ?? ""]);
      yield { type: "stdout", data: output };
      yield { type: "exit", code: 0 };
      return;
    }
    if (request.argv[3] === "atlas-background-launch") {
      const issue = "Shell execution is unavailable in this offline eval sandbox.";
      if (!this.harnessIssues.includes(issue)) this.harnessIssues.push(issue);
      yield { type: "stderr", data: issue };
      yield { type: "exit", code: 127 };
      return;
    }
    yield* super.execute(computer, request, context);
  }
}
