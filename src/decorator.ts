import { DecorationOptions, Position, Range, Selection, TextEditor, TextEditorDecorationType, WorkspaceConfiguration } from "vscode";
import { maskDecorationOptions, noDecoration, unfoldedDecorationOptions } from "./decoration";
import { CONFIGS } from "./enums";
import { ExtSettings } from "./settings";

export class Decorator {
  WorkspaceConfigs: WorkspaceConfiguration;
  UnfoldedDecoration: TextEditorDecorationType;
  MaskDecoration: TextEditorDecorationType;
  NoDecorations: TextEditorDecorationType;
  CurrentEditor: TextEditor;
  ParsedRegexString: string;
  SupportedLanguages: string[] = [];
  Offset: number = 30;
  Active: boolean = true;
  StartLine: number = 0;
  EndLine: number = 0;

  /**
  * To set/update the current working text editor.
  * It's neccessary to call this method when the active editor changes
  * because somethimes it return as undefined.
  * @param textEditor TextEditor
  */
  activeEditor(textEditor: TextEditor) {
    if (!textEditor) return;
    this.CurrentEditor = textEditor;
    this.startLine(textEditor.visibleRanges[0].start.line);
    this.endLine(textEditor.visibleRanges[0].end.line);
    this.updateDecorations();
  }

  /**
  * Set the number of the starting line of where the decoration should be applied.
  * @param n number
  */
  startLine(n: number) {
    this.StartLine = n - this.Offset <= 0 ? 0 : n - this.Offset;
  }

  /**
  * Set the number of the ending line of where the decoration should be applied.
  * @param n number
  */
  endLine(n: number) {
    this.EndLine = n + this.Offset >= this.CurrentEditor.document.lineCount ? this.CurrentEditor.document.lineCount : n + this.Offset;
  }

  /**
   * Set the extension default state either to be activated or not.
   */
  setDefault() {
    ExtSettings.setDefault();
    this.updateDecorations();
  }

  /**
  * Set the active state of the decorator (used for command)
  */
  toggle() {
    this.Active = !this.Active;
    this.updateDecorations();
  }

  /**
  * This method gets triggered when the extension settings are changed
  * @param extConfs: Workspace configs
  */
  updateConfigs(extConfs: WorkspaceConfiguration) {
    this.WorkspaceConfigs = extConfs;
    this.SupportedLanguages = extConfs.get(CONFIGS.SUPPORTED_LANGUAGES) || [];
    this.UnfoldedDecoration = unfoldedDecorationOptions(extConfs);
    this.MaskDecoration = maskDecorationOptions(extConfs);
    this.NoDecorations = noDecoration();
    this.ParsedRegexString = this.parseRegexString(extConfs.get(CONFIGS.REGEX), extConfs.get(CONFIGS.REGEX_GROUP) || 1);
  }


  updateDecorations() {
    if (
      ExtSettings.get(CONFIGS.ENABLED) ||
      !this.SupportedLanguages ||
      !this.ParsedRegexString ||
      !this.SupportedLanguages.includes(this.CurrentEditor.document.languageId)) {
      return;
    }

    const shouldFoldOnLineSelect = this.WorkspaceConfigs.get(CONFIGS.UNFOLDED_ON_LINE_SELECT) as boolean
    const regexGroup: number = parseInt(this.WorkspaceConfigs.get(CONFIGS.REGEX_GROUP)) || 1;
    const regEx: RegExp = RegExp(this.ParsedRegexString, this.WorkspaceConfigs.get(CONFIGS.REGEX_FLAGS));
    const text: string = this.CurrentEditor.document.getText();
    const decorators: DecorationOptions[] = [];

    let match;
    while (match = regEx.exec(text)) {
      if (match.length <= regexGroup + 1) {
        console.error("The regex was wrong");
        break;
      }
      const foldIndex = match[1].length;
      const foldEndIndex = match[1 + regexGroup].length;

      // match.index is the start of the entire match
      const startFoldPosition = this.startPositionLine([match.index, foldIndex])
      const endFoldPosition = this.endPositionLine([match.index, foldIndex + foldEndIndex])
      /* Creating a new range object from the calculated positions. */
      const range = new Range(startFoldPosition, endFoldPosition);

      /* Checking if the toggle command is active or not. If it is not active, it will remove all decorations. */
      if (!this.Active) {
        this.CurrentEditor.setDecorations(this.NoDecorations, []);
        break;
      }

      /* Checking if the range is within the visible area of the editor plus a specified offset for a head decoration. */
      if (!(this.StartLine <= range.start.line && range.end.line <= this.EndLine)) {
        continue;
      }

      /* Pushing the range and the hoverMessage to the decorators array to apply later. */
      decorators.push({
        range,
        hoverMessage: `Full text **${match[regexGroup + 1]}**`
      });
    }

    this.CurrentEditor.setDecorations(this.UnfoldedDecoration, decorators);

    let decorationsToFold = decorators
      .map(({ range }) => range)
      .filter((r) => !r.contains(this.CurrentEditor.selection) && !this.CurrentEditor.selection.contains(r))
      .filter((r) => !this.CurrentEditor.selections.find((s) => r.contains(s)))

    if (shouldFoldOnLineSelect){
      const isInTheLineRange = (range : Range , targetRange : Range) => {
        return range.start.line <= targetRange.start.line && range.end.line >= targetRange.start.line
      }
      decorationsToFold = decorationsToFold
        .filter((r) => !isInTheLineRange(this.CurrentEditor.selection , r))
        .filter((r) => !this.CurrentEditor.selections.find((s) => isInTheLineRange(s , r)))
    }

    this.CurrentEditor.setDecorations(
      this.MaskDecoration,
      decorationsToFold
    )
  }

  /**
   * Parse the regex in such a way that the to-be-folded group is always group number 2.
   */
  parseRegexString(reg: string, regexGroup: number): string {
    // find the start of the to-be-folded group
    const foldStart = reg.split('(', regexGroup).join('(').length;

    // place a ( at the front and a ) before the to-be-folded group
    reg = '(' + reg.substring(0, foldStart) + ')' + reg.substring(foldStart);
    return reg;
  }

  /**
   * It sums an array of numbers and returns a Position object that 
   * represents the end position of the matched column.
   * 
   * @param totalOffset number[]
   * @return The position of the cursor in the document.
   */
  startPositionLine(totalOffset: any): Position {
    return this.CurrentEditor.document.positionAt(
      totalOffset.reduce((partialSum: number, a: number) => partialSum + a, 0)
    );
  }

  /**
   * It takes an array of numbers, and returns a Position object that 
   * represents the end position of the matched column.
   * 
   * @param totalOffset number[]
   * @return The position of the end of the line.
   */
  endPositionLine(totalOffset: any): Position {
    return this.CurrentEditor.document.positionAt(
      totalOffset.reduce((thisSum: number, next: number) => thisSum + next, 0)
    );
  }

  constructor () { }
}