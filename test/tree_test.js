const Parser = require("tree-sitter");
const { assert } = require("chai");
const { dsl, generate, loadLanguage } = require("..");
const { choice, prec, repeat, seq, grammar } = dsl;
const ARITHMETIC = require('./fixtures/arithmetic_language');

describe("Tree", () => {
  let parser;

  beforeEach(() => {
    parser = new Parser();
    parser.setLanguage(ARITHMETIC)
  });

  describe('.edit', () => {
    let input, edit

    it('updates the positions of existing nodes', () => {
      input = 'abc + cde';

      tree = parser.parse(input);
      assert.equal(
        tree.rootNode.toString(),
        "(program (sum (variable) (variable)))"
      );

      let variableNode1 = tree.rootNode.firstChild.firstChild;
      let variableNode2 = tree.rootNode.firstChild.lastChild;
      assert.equal(variableNode1.startIndex, 0);
      assert.equal(variableNode1.endIndex, 3);
      assert.equal(variableNode2.startIndex, 6);
      assert.equal(variableNode2.endIndex, 9);

      ([input, edit] = spliceInput(input, input.indexOf('bc'), 0, ' * '));
      assert.equal(input, 'a * bc + cde');

      tree.edit(edit);
      assert.equal(variableNode1.startIndex, 0);
      assert.equal(variableNode1.endIndex, 6);
      assert.equal(variableNode2.startIndex, 9);
      assert.equal(variableNode2.endIndex, 12);

      tree = parser.parse(input, tree);
      assert.equal(
        tree.rootNode.toString(),
        "(program (sum (product (variable) (variable)) (variable)))"
      );
    });

    it("handles non-ascii characters", () => {
      input = 'αβδ + cde';

      tree = parser.parse(input);
      assert.equal(
        tree.rootNode.toString(),
        "(program (sum (variable) (variable)))"
      );

      const variableNode = tree.rootNode.firstChild.lastChild;

      ([input, edit] = spliceInput(input, input.indexOf('δ'), 0, '👍 * '));
      assert.equal(input, 'αβ👍 * δ + cde');

      tree.edit(edit);
      assert.equal(variableNode.startIndex, input.indexOf('cde'));

      tree = parser.parse(input, tree);
      assert.equal(
        tree.rootNode.toString(),
        "(program (sum (product (variable) (variable)) (variable)))"
      );
    });
  });

  describe('.getEditedRange()', () => {
    it('returns the range of tokens that have been edited', () => {
      const inputString = 'abc + def + ghi + jkl + mno';
      const tree = parser.parse(inputString);

      assert.equal(tree.getEditedRange(), null)

      tree.edit({
        startIndex: 7,
        oldEndIndex: 7,
        newEndIndex: 8,
        startPosition: { row: 0, column: 7 },
        oldEndPosition: { row: 0, column: 7 },
        newEndPosition: { row: 0, column: 8 }
      });

      tree.edit({
        startIndex: 21,
        oldEndIndex: 21,
        newEndIndex: 22,
        startPosition: { row: 0, column: 21 },
        oldEndPosition: { row: 0, column: 21 },
        newEndPosition: { row: 0, column: 22 }
      });

      assert.deepEqual(tree.getEditedRange(), {
        startIndex: 6,
        endIndex: 23,
        startPosition: {row: 0, column: 6},
        endPosition: {row: 0, column: 23},
      });
    })
  });

  describe(".getChangedRanges()", () => {
    let language

    before(() => {
      language = loadLanguage(
        generate(
          grammar({
            name: "test2",
            rules: {
              expression: $ =>
                choice(
                  prec.left(seq($.expression, "+", $.expression)),
                  $.variable
                ),

              variable: $ => /\w+/
            }
          })
        )
      );
    });

    it("reports the ranges of text whose syntactic meaning has changed", () => {
      parser.setLanguage(language);

      let sourceCode = "abcdefg + hij";
      const tree1 = parser.parse(sourceCode);

      assert.equal(
        tree1.rootNode.toString(),
        "(expression (expression (variable)) (expression (variable)))"
      );

      sourceCode = "abc + defg + hij";
      tree1.edit({
        startIndex: 2,
        oldEndIndex: 2,
        newEndIndex: 5,
        startPosition: { row: 0, column: 2 },
        oldEndPosition: { row: 0, column: 2 },
        newEndPosition: { row: 0, column: 5 }
      });

      const tree2 = parser.parse(sourceCode, tree1);
      assert.equal(
        tree2.rootNode.toString(),
        "(expression (expression (expression (variable)) (expression (variable))) (expression (variable)))"
      );

      const ranges = tree1.getChangedRanges(tree2);
      assert.deepEqual(ranges, [
        {
          startIndex: 0,
          endIndex: "abc + defg".length,
          startPosition: { row: 0, column: 0 },
          endPosition: { row: 0, column: "abc + defg".length }
        }
      ]);
    });

    it('throws an exception if the argument is not a tree', () => {
      parser.setLanguage(language);
      const tree1 = parser.parse("abcdefg + hij");

      assert.throws(() => {
        tree1.getChangedRanges({});
      }, /Argument must be a tree/);
    })
  });

  describe(".walk()", () => {
    it('returns a cursor that can be used to walk the tree', () => {
      const tree = parser.parse('a * b + c / d');

      const cursor = tree.walk();
      let expected = {
        nodeType: 'program',
        nodeIsNamed: true,
        startPosition: {row: 0, column: 0},
        endPosition: {row: 0, column: 13},
        startIndex: 0,
        endIndex: 13
      }
      checkCursorNode(cursor, expected);
      checkCursorNode(cursor.currentNode, expected);

      assert(cursor.gotoFirstChild());
      expected = {
        nodeType: 'sum',
        nodeIsNamed: true,
        startPosition: {row: 0, column: 0},
        endPosition: {row: 0, column: 13},
        startIndex: 0,
        endIndex: 13
      }
      checkCursorNode(cursor, expected);
      checkCursorNode(cursor.currentNode, expected);

      assert(cursor.gotoFirstChild());
      expected = {
        nodeType: 'product',
        nodeIsNamed: true,
        startPosition: {row: 0, column: 0},
        endPosition: {row: 0, column: 5},
        startIndex: 0,
        endIndex: 5
      }
      checkCursorNode(cursor, expected);
      checkCursorNode(cursor.currentNode, expected);

      assert(cursor.gotoFirstChild());
      expected = {
        nodeType: 'variable',
        nodeIsNamed: true,
        startPosition: {row: 0, column: 0},
        endPosition: {row: 0, column: 1},
        startIndex: 0,
        endIndex: 1
      }
      checkCursorNode(cursor, expected);
      checkCursorNode(cursor.currentNode, expected);

      assert(!cursor.gotoFirstChild())
      assert(cursor.gotoNextSibling());
      expected = {
        nodeType: '*',
        nodeIsNamed: false,
        startPosition: {row: 0, column: 2},
        endPosition: {row: 0, column: 3},
        startIndex: 2,
        endIndex: 3
      }
      checkCursorNode(cursor, expected);
      checkCursorNode(cursor.currentNode, expected);

      assert(cursor.gotoNextSibling());
      expected = {
        nodeType: 'variable',
        nodeIsNamed: true,
        startPosition: {row: 0, column: 4},
        endPosition: {row: 0, column: 5},
        startIndex: 4,
        endIndex: 5
      }
      checkCursorNode(cursor, expected);
      checkCursorNode(cursor.currentNode, expected);

      assert(!cursor.gotoNextSibling());
      assert(cursor.gotoParent());
      expected = {
        nodeType: 'product',
        nodeIsNamed: true,
        startPosition: {row: 0, column: 0},
        endPosition: {row: 0, column: 5},
        startIndex: 0,
        endIndex: 5
      }
      checkCursorNode(cursor, expected);
      checkCursorNode(cursor.currentNode, expected);

      assert(cursor.gotoNextSibling());
      expected = {
        nodeType: '+',
        nodeIsNamed: false,
        startPosition: {row: 0, column: 6},
        endPosition: {row: 0, column: 7},
        startIndex: 6,
        endIndex: 7
      }
      checkCursorNode(cursor, expected);
      checkCursorNode(cursor.currentNode, expected);

      assert(cursor.gotoNextSibling());
      expected = {
        nodeType: 'quotient',
        nodeIsNamed: true,
        startPosition: {row: 0, column: 8},
        endPosition: {row: 0, column: 13},
        startIndex: 8,
        endIndex: 13
      }
      checkCursorNode(cursor, expected);
      checkCursorNode(cursor.currentNode, expected);

      const childIndex = cursor.gotoFirstChildForIndex(12);
      expected = {
        nodeType: 'variable',
        nodeIsNamed: true,
        startPosition: {row: 0, column: 12},
        endPosition: {row: 0, column: 13},
        startIndex: 12,
        endIndex: 13
      }
      checkCursorNode(cursor, expected);
      checkCursorNode(cursor.currentNode, expected);
      assert.equal(childIndex, 2);

      assert(!cursor.gotoNextSibling());
      assert(cursor.gotoParent());
      assert(cursor.gotoParent());
      assert(cursor.gotoParent());
      assert(!cursor.gotoParent());
    });
  });
});

function checkCursorNode(target, expected) {
  if (target instanceof Parser.SyntaxNode) {
    assert.equal(target.type, expected.nodeType);
    assert.equal(target.isNamed, expected.nodeIsNamed);
  } else {
    assert.equal(target.nodeType, expected.nodeType);
    assert.equal(target.nodeIsNamed, expected.nodeIsNamed);
  }
  assert.deepEqual(target.startPosition, expected.startPosition);
  assert.deepEqual(target.endPosition, expected.endPosition);
  assert.deepEqual(target.startIndex, expected.startIndex);
  assert.deepEqual(target.endIndex, expected.endIndex);
}

function spliceInput(input, startIndex, lengthRemoved, newText) {
  const oldEndIndex = startIndex + lengthRemoved;
  const newEndIndex = startIndex + newText.length;
  const startPosition = getExtent(input.slice(0, startIndex));
  const oldEndPosition = getExtent(input.slice(0, oldEndIndex));
  input = input.slice(0, startIndex) + newText + input.slice(oldEndIndex);
  const newEndPosition = getExtent(input.slice(0, newEndIndex));
  return [
    input,
    {
      startIndex, startPosition,
      oldEndIndex, oldEndPosition,
      newEndIndex, newEndPosition
    }
  ];
}

function getExtent(text) {
  let row = 0
  let index;
  for (index = 0; index != -1; index = text.indexOf('\n', index)) {
    index++
    row++;
  }
  return {row, column: text.length - index};
}
