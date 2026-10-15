import inquirer from "inquirer";

export const CLI = {
  async message(message: string, defaultValue?: string): Promise<string> {
    const answers = await inquirer.prompt<{ response: string }>({
      type: "input",
      name: "response",
      message,
      default: defaultValue,
    });
    return answers.response;
  },


  async select(message: string, choices: string[], defaultValue?: string): Promise<string> {
    const answers = await inquirer.prompt<{ response: string }>({
      type: "select",
      name: "response",
      message,
      choices,
      default: defaultValue,
    });
    return answers.response;
  },

  print(...lines: any[]): void {
    const txt = lines.map(loggable).join("\n");
    console.log(txt);
  }
};

const loggable = (message: any): string => {
  if (typeof message === "string") {
    return message;
  }

  if (message instanceof Error) {
    return message.message;
  }

  if (typeof message === "object") {
    try {
      return JSON.stringify(message, null, 2);
    } catch (e) {
      return String(message);
    }
  }

  return String(message);
}
