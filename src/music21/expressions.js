/**
 * Expressions module.  See {@link music21.expressions}
 * Expressions can be note attached (`music21.note.Note.expressions[]`) or floating...
 *
 * @exports music21/expressions
 * @namespace music21.expressions
 * @memberof music21
 * @requires music21/expressions
 */

import Vex from 'vexflow';
import * as base from './base';

/**
 * Expressions can be note attached (`music21.note.Note.expressions[]`) or floating...
 *
 * @class Expression
 * @memberof music21.expressions
 * @extends music21.base.Music21Object
 * @property {string} name
 * @property {string} vexflowModifier
 * @property {int} setPosition
 */
export class Expression extends base.Music21Object {
    static get className() { return 'music21.expressions.Expression'; }

    constructor() {
        super();
        this.name = 'expression';
        this.vexflowModifier = '';
        this.setPosition = undefined;
    }

    /**
     * Renders this Expression as a Vex.Flow.Articulation
     *
     * (this is not right for all cases)
     *
     * @returns {Vex.Flow.Articulation}
     */
    vexflow() {
        const vfe = new Vex.Flow.Articulation(this.vexflowModifier);
        if (this.setPosition) {
            vfe.setPosition(this.setPosition);
        }
        return vfe;
    }
}

/**
 * A fermata...
 *
 * @class Fermata
 * @memberof music21.expressions
 * @extends music21.expressions.Expression
 */
export class Fermata extends Expression {
    static get className() { return 'music21.expressions.Fermata'; }

    constructor() {
        super();
        this.name = 'fermata';
        this.vexflowModifier = 'a@a';
        this.setPosition = 3;
    }
}
