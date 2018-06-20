const Parser = require("tree-sitter");
const { assert } = require("chai");
const { dsl, generate, loadLanguage } = require("..");
const { choice, prec, repeat, seq, grammar } = dsl;
const {TextBuffer} = require('superstring');
const ARITHMETIC = require('./fixtures/arithmetic_language');

describe("Parser", () => {
  let parser, language;

  before(() => {
    language = loadLanguage(
      generate(
        grammar({
          name: "test",
          rules: {
            sentence: $ => repeat(choice($.word1, $.word2, $.word3, $.word4)),
            word1: $ => "first-word",
            word2: $ => "second-word",
            word3: $ => "αβ",
            word4: $ => "αβδ"
          }
        })
      )
    );
  });

  beforeEach(() => {
    parser = new Parser();
  });

  describe(".setLanguage", () => {
    describe("when the supplied object is not a tree-sitter language", () => {
      it("throws an exception", () => {
        assert.throws(() => parser.setLanguage({}), /Invalid language/);

        assert.throws(() => parser.setLanguage(undefined), /Invalid language/);
      });
    });

    describe("when the input has not yet been set", () => {
      it("doesn't try to parse", () => {
        parser.setLanguage(language);
        assert.equal(null, parser.children);
      });
    });
  });

  describe(".setLogger", () => {
    let debugMessages;

    beforeEach(() => {
      debugMessages = [];
      parser.setLanguage(language);
      parser.setLogger((message) => debugMessages.push(message));
    });

    it("calls the given callback for each parse event", () => {
      parser.parse("first-word second-word");
      assert.includeMembers(debugMessages, ["reduce", "accept", "shift"]);
    });

    it("allows the callback to be retrieved later", () => {
      let callback = () => null;

      parser.setLogger(callback);
      assert.equal(callback, parser.getLogger());

      parser.setLogger(false);
      assert.equal(null, parser.getLogger());
    });

    describe("when given a falsy value", () => {
      beforeEach(() => {
        parser.setLogger(false);
      });

      it("disables debugging", () => {
        parser.parse("first-word second-word");
        assert.equal(0, debugMessages.length);
      });
    });

    describe("when given a truthy value that isn't a function", () => {
      it("raises an exception", () => {
        assert.throws(
          () => parser.setLogger("5"),
          /Logger callback must .* function .* falsy/
        );
      });
    });

    describe("when the given callback throws an exception", () => {
      let errorMessages, originalConsoleError, thrownError;

      beforeEach(() => {
        errorMessages = [];
        thrownError = new Error("dang.");

        originalConsoleError = console.error;
        console.error = (message, error) => {
          errorMessages.push([message, error]);
        };

        parser.setLogger((msg, params) => {
          throw thrownError;
        });
      });

      afterEach(() => {
        console.error = originalConsoleError;
      });

      it("logs the error to the console", () => {
        parser.parse("first-word");

        assert.deepEqual(errorMessages[0], [
          "Error in debug callback:",
          thrownError
        ]);
      });
    });
  });

  describe(".parse", () => {
    beforeEach(() => {
      parser.setLanguage(language);
    });

    it("reads from the given input", () => {
      parser.setLanguage(language);

      const parts = ["first", "-", "word", " ", "second", "-", "word", ""];
      const tree = parser.parse(() => parts.shift());

      assert.equal("(sentence (word1) (word2))", tree.rootNode.toString());
    });

    describe("when the input callback returns something other than a string", () => {
      it("stops reading", () => {
        parser.setLanguage(language);

        const parts = ["first", "-", "word", {}, "second-word", " "];
        const tree = parser.parse(() => parts.shift());

        assert.equal("(sentence (word1))", tree.rootNode.toString());
        assert.equal(parts.length, 2);
      });
    });

    describe("when the given input is not a function", () => {
      it("throws an exception", () => {
        assert.throws(() => parser.parse(null), /Input.*function/);
        assert.throws(() => parser.parse(5), /Input.*function/);
        assert.throws(() => parser.parse({}), /Input.*function/);
      });
    });

    it("handles long input strings", () => {
      const repeatCount = 10000;
      const wordCount = 4 * repeatCount;
      const inputString = "first-word second-word αβ αβδ".repeat(repeatCount);

      const tree = parser.parse(inputString);
      assert.equal(tree.rootNode.type, "sentence");
      assert.equal(tree.rootNode.childCount, wordCount);
    });

    describe('when the `includedRanges` option is given', () => {
      it('parses the text within those ranges of the string', () => {
        const sourceCode = "const expression = `1 + a${c}b * 4`";
        const exprStart = sourceCode.indexOf('1');
        const interpStart = sourceCode.indexOf('${');
        const interpEnd = sourceCode.indexOf('}') + 1;
        const exprEnd = sourceCode.lastIndexOf('`');

        parser.setLanguage(ARITHMETIC);

        const tree = parser.parse(sourceCode, null, {
          includedRanges: [
            {
              startIndex: exprStart,
              endIndex: interpStart,
              startPosition: {row: 0, column: exprStart},
              endPosition: {row: 0, column: interpStart}
            },
            {
              startIndex: interpEnd,
              endIndex: exprEnd,
              startPosition: {row: 0, column: interpEnd},
              endPosition: {row: 0, column: exprEnd}
            },
          ]
        });

        assert.equal(tree.rootNode.toString(), '(program (sum (number) (product (variable) (number))))');
      })
    })
  });

  describe('.parseTextBuffer', () => {
    beforeEach(() => {
      parser.setLanguage(language);
    });

    it('parses the contents of the given text buffer asynchronously', async () => {
      const repeatCount = 4;
      const wordCount = 4 * repeatCount;
      const repeatedString = "first-word second-word αβ αβδ ";
      const buffer = new TextBuffer(repeatedString.repeat(repeatCount))

      const tree = await parser.parseTextBuffer(buffer);
      assert.equal(tree.rootNode.type, "sentence");
      assert.equal(tree.rootNode.children.length, wordCount);

      const editIndex = repeatedString.length * 2;
      buffer.setTextInRange(
        {start: {row: 0, column: editIndex}, end: {row: 0, column: editIndex}},
        'αβδ '
      );
      tree.edit({
        startIndex: editIndex,
        oldEndIndex: editIndex,
        newEndIndex: editIndex + 4,
        startPosition: {row: 0, column: editIndex},
        oldEndPosition: {row: 0, column: editIndex},
        newEndPosition: {row: 0, column: editIndex + 4}
      });

      const newTree = await parser.parseTextBuffer(buffer, tree);
      assert.equal(newTree.rootNode.type, "sentence");
      assert.equal(newTree.rootNode.children.length, wordCount + 1);
    });

    it('does not allow the parser to be mutated while parsing', async () => {
      const buffer = new TextBuffer('first-word second-word first-word second-word');
      const treePromise = parser.parseTextBuffer(buffer);

      assert.throws(() => {
        parser.parse('first-word');
      }, /Parser is in use/);

      assert.throws(() => {
        parser.setLanguage(language);
      }, /Parser is in use/);

      assert.throws(() => {
        parser.printDotGraphs(true);
      }, /Parser is in use/);

      const tree = await treePromise;
      assert.equal(tree.rootNode.type, "sentence");
      assert.equal(tree.rootNode.children.length, 4);

      parser.parse('first-word');
      parser.setLanguage(language);
      parser.printDotGraphs(true);
    });

    it('throws an error if the given object is not a TextBuffer', () => {
      assert.throws(() => {
        parser.parseTextBuffer({});
      });
    });

    it('does not try to call JS logger functions when parsing asynchronously', async () => {
      const messages = [];
      parser.setLogger(message => messages.push(message));

      const tree1 = parser.parse('first-word second-word');
      assert(messages.length > 0);
      messages.length = 0;

      const buffer = new TextBuffer('first-word second-word');
      const tree2 = await parser.parseTextBuffer(buffer);
      assert(messages.length === 0);

      const tree3 = parser.parseTextBufferSync(buffer);
      assert(messages.length > 0);

      assert.equal(tree2.rootNode.toString(), tree1.rootNode.toString())
      assert.equal(tree3.rootNode.toString(), tree1.rootNode.toString())
    })

    describe('when the `includedRanges` option is given', () => {
      it('parses the text within those ranges of the string', async () => {
        const sourceCode = "const expression = `1 + a${c}b * 4`";
        const exprStart = sourceCode.indexOf('1');
        const interpStart = sourceCode.indexOf('${');
        const interpEnd = sourceCode.indexOf('}') + 1;
        const exprEnd = sourceCode.lastIndexOf('`');

        parser.setLanguage(ARITHMETIC);

        const tree = await parser.parseTextBuffer(new TextBuffer(sourceCode), null, {
          includedRanges: [
            {
              startIndex: exprStart,
              endIndex: interpStart,
              startPosition: {row: 0, column: exprStart},
              endPosition: {row: 0, column: interpStart}
            },
            {
              startIndex: interpEnd,
              endIndex: exprEnd,
              startPosition: {row: 0, column: interpEnd},
              endPosition: {row: 0, column: exprEnd}
            },
          ]
        });

        assert.equal(tree.rootNode.toString(), '(program (sum (number) (product (variable) (number))))');
      })
    })
  });

  describe('.parseTextBufferSync', () => {
    it('parses the contents of the given text buffer synchronously', () => {
      parser.setLanguage(language);
      const buffer = new TextBuffer('αβ αβδ')
      const tree = parser.parseTextBufferSync(buffer);
      assert.equal(tree.rootNode.type, "sentence");
      assert.equal(tree.rootNode.children.length, 2);
    });

    it('returns null if no language has been set', () => {
      const buffer = new TextBuffer('αβ αβδ')
      const tree = parser.parseTextBufferSync(buffer);
      assert.equal(tree, null);
    })
  });
});
