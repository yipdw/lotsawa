"use strict";

var bitmv = require('bitmv');
var bv_or_assign = bitmv.bv_or_assign;
var bv_bit_set = bitmv.bv_bit_set;
var bv_bit_test = bitmv.bv_bit_test;

function Grammar(rules) {
  rules.push(Rule('_start', [Ref('start')]));

  rules.symbols = censusSymbols();
  rules.sympred = generateSymbolMatrix();

  function censusSymbols() {
    var out = [];
    rules.forEach(function(r) {
      if (!~out.indexOf(r.name)) {
        out.push(r.name);
      }
      r.symbols.forEach(function(s, i) {
        var symNo = out.indexOf(s.name);
        if (!~out.indexOf(s.name)) {
          symNo = out.length;
          out.push(s.name);
        }

        r.symbols[i] = symNo;
      });

      r.sym = out.indexOf(r.name);
    });

    return out;
  }

  function generateSymbolMatrix() {
    var predictable = bitmv.matrix(rules.symbols.length, rules.symbols.length);

    // Build a matrix of what symbols predict what other symbols, so we can just jump straight to the
    // answer rather than having to do these loops at each pass. Bitsets are fun.
    rules.symbols.forEach(function(name, sym) {
      rules.forEach(function(r) {
        if (r.symbols[0] != null && r.symbols[0] == sym) {
          bv_bit_set(predictable[sym], r.sym);
        }
      });
      bv_bit_set(predictable[sym], sym);
    });
    bitmv.transitiveClosure(predictable);

    return predictable;
  }

  function generatePredictionMatrix() {
    var predictable = bitmv.matrix(rules.symbols.length, rules.length);
    rules.forEach(function(r, j) {
      rules.forEach(function(s, k) {
        if (r.symbols[0] != null && r.symbols[0] == s.sym) {
          bv_bit_set(predictable[r.sym], k);
        }
      });

      bv_bit_set(predictable[r.sym], j);
    });

    bitmv.transitiveClosure(predictable);

    return predictable;
  }

  rules.predictions_for_symbols = generatePredictionMatrix();

  return rules;
}

function Rule(name, syms) {
  return {
    name: name,
    symbols: syms
  };
}

function Ref(name) {
  return {
    name: name
  };
}

function Terminal(symbol) {
  return {
    name: symbol,
    terminal: symbol
  };
}

function parse(grammar, toParse, debug) {
  var table = [];

  for (var i = 0; i < toParse.length; i++) {
    if (debug) {
      debug('set', i, toParse[i], 'sym', symbolOf(toParse[i]));
    }
    table[i] = {
      predictions: predict(i),
      completions: []
    };

    scan(i);

    advance(i);

    complete(i);

    if (debug) {
      debug(table, i);
    }
  }

  return success(table[table.length - 1]);

  function success(tab) {
    var matches = 0;
    if (toParse.length == 0 && !tab) {
      return true;
    }
    for (var j = 0; j < tab.completions.length; j++) {
      var dr = tab.completions[j];
      if (dr.origin === 0 && dr.ruleNo == grammar.length - 1 && dr.pos == grammar[grammar.length - 1].symbols.length) {
        matches++;
      }
    }

    if (matches === 0) {
      if (debug) {
        debug('parse failed');
      }
    } else if (matches == 1) {
      if (debug) {
        debug('parse succeeded');
      }
      return true;
    } else {
      if (debug) {
        debug('parse was ambiguous');
      }
    }
    return false;
  }

  function predict(which) {
    var predictions = bitmv.vector(grammar.length);
    var prev = table[which - 1];
    if (!prev) {
      bv_or_assign(predictions, grammar.predictions_for_symbols[grammar.symbols.indexOf('_start')]);
    } else {
      for (var j = 0; j < prev.completions.length; j++) {
        var drule = prev.completions[j];
        var pos = drule.pos;
        var rule = grammar[drule.ruleNo];
        if (rule.symbols.length > pos) {
          bv_or_assign(predictions, grammar.predictions_for_symbols[rule.symbols[pos]]);
        }
      }
    }

    return predictions;
  }

  function scan(which) {
    var sym = symbolOf(toParse[which]);
    if (!~sym) return;

    bv_scan(table[which].predictions, function(ruleNo) {
      if (grammar[ruleNo].symbols[0] == sym) {
        table[which].completions.push({
          ruleNo: ruleNo,
          pos: 1,
          origin: which,
          kind: 'S'
        });
      }
    });
  }

  function advance(which) {
    var sym = symbolOf(toParse[which]);
    if (!~sym) return;

    var prev = table[which - 1];
    var cur = table[which];

    if (!prev) return;
    for (var j = 0; j < prev.completions.length; j++) {
      var drule = prev.completions[j];
      var rule = grammar[drule.ruleNo];
      if (rule.symbols[drule.pos] == sym) {
        var candidate = prev.completions[j];
        add(cur.completions, {
          ruleNo: candidate.ruleNo,
          pos: candidate.pos + 1,
          origin: candidate.origin,
          kind: 'A'
        });
      }
    }
  }

  function complete(which) {
    var cur = table[which];
    for (var j = 0; j < cur.completions.length; j++) {
      var ruleNo = cur.completions[j].ruleNo;
      var pos = cur.completions[j].pos;
      var origin = cur.completions[j].origin;
      var sym = grammar[ruleNo].sym;
      if (!~origin) continue;
      if (pos < grammar[ruleNo].symbols.length) continue;

      bv_scan(table[origin].predictions, predictForRuleNo);

      if (!table[origin - 1]) return;
      for (var k = 0; k < table[origin - 1].completions.length; k++) {
        var candidate = table[origin - 1].completions[k];
        if (bv_bit_test(grammar.sympred[sym], grammar[candidate.ruleNo].symbols[candidate.pos])) {
          add(cur.completions, {
            ruleNo: candidate.ruleNo,
            pos: candidate.pos + 1,
            origin: candidate.origin,
            kind: 'P'
          });
        }
      }
    }

    function predictForRuleNo(predictedRuleNo) {
      if (bv_bit_test(grammar.sympred[sym], grammar[predictedRuleNo].symbols[0])) {
        add(cur.completions, {
          ruleNo: predictedRuleNo,
          pos: 1,
          origin: origin,
          kind: 'C'
        });
      }
    }
  }

  function symbolOf(token) {
    return grammar.symbols.indexOf(token);
  }
}

function add(table, rule) {
  for (var l = 0; l < table.length; l++) {
    if (ruleEqual(table[l], rule)) return;
  }

  table.push(rule);
}

function ruleEqual(a, b) {
  return a.ruleNo == b.ruleNo && a.pos == b.pos && a.origin == b.origin;
}

function bv_scan(vec, iter) {
  for (var i = 0; i < vec.bits; i++) {
    if (bitmv.bv_bit_test(vec, i)) {
      iter(i);
    }
  }
}


module.exports = {
  Grammar: Grammar,
  Rule: Rule,
  Ref: Ref,
  Terminal: Terminal,
  parse: parse
};
