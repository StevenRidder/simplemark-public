import { describe, expect, it } from 'vitest'

import { NoteWalk } from '../../src/app/note-walk.js'

/**
 * Recent Notes moves an opened note to the front, so the list re-sorts while
 * you walk it. `recencyList` reproduces exactly that.
 */
const recencyList = (initial: readonly string[]) => {
  let order = [...initial]
  return {
    order: (): readonly string[] => order,
    open: (id: string): void => {
      order = [id, ...order.filter((candidate) => candidate !== id)]
    },
  }
}

describe('NoteWalk', () => {
  it('steps down the list and wraps at the bottom', () => {
    const walk = new NoteWalk()
    const order = ['a', 'b', 'c']
    expect(walk.step(order, 'a', 1)).toBe('b')
    expect(walk.step(order, 'b', 1)).toBe('c')
    expect(walk.step(order, 'c', 1)).toBe('a')
  })

  it('steps up the list and wraps at the top', () => {
    const walk = new NoteWalk()
    const order = ['a', 'b', 'c']
    expect(walk.step(order, 'c', -1)).toBe('b')
    expect(walk.step(order, 'b', -1)).toBe('a')
    expect(walk.step(order, 'a', -1)).toBe('c')
  })

  it('keeps walking forward while the list re-sorts underneath it', () => {
    // The reported bug. Opening a note moves it to the front, so reading the
    // next note from the live list stepped to the second note, watched it
    // become the first, and then stepped back to where it came from — down,
    // down, down bouncing between the top two notes forever.
    const list = recencyList(['a', 'b', 'c', 'd'])
    const walk = new NoteWalk()
    const visited: string[] = []
    let active = 'a'

    for (let press = 0; press < 3; press += 1) {
      const next = walk.step(list.order(), active, 1)
      expect(next).toBeDefined()
      active = next!
      list.open(active)
      visited.push(active)
    }

    expect(visited).toEqual(['b', 'c', 'd'])
  })

  it('keeps walking backward while the list re-sorts underneath it', () => {
    const list = recencyList(['a', 'b', 'c', 'd'])
    const walk = new NoteWalk()
    const visited: string[] = []
    let active = 'd'

    for (let press = 0; press < 3; press += 1) {
      const next = walk.step(list.order(), active, -1)
      active = next!
      list.open(active)
      visited.push(active)
    }

    expect(visited).toEqual(['c', 'b', 'a'])
  })

  it('walks every note exactly once before returning to the start', () => {
    const list = recencyList(['a', 'b', 'c', 'd'])
    const walk = new NoteWalk()
    const visited: string[] = []
    let active = 'a'

    for (let press = 0; press < 4; press += 1) {
      active = walk.step(list.order(), active, 1)!
      list.open(active)
      visited.push(active)
    }

    expect(visited).toEqual(['b', 'c', 'd', 'a'])
    expect(new Set(visited).size).toBe(4)
  })

  it('starts a fresh walk when something else moved the selection', () => {
    const walk = new NoteWalk()
    expect(walk.step(['a', 'b', 'c'], 'a', 1)).toBe('b')

    // A sidebar click on 'c', and the list has re-sorted around it. The walk is
    // no longer the thing driving, so the next press reads the live order.
    expect(walk.step(['c', 'a', 'b'], 'c', 1)).toBe('a')
  })

  it('starts a fresh walk when the listed notes change, not merely their order', () => {
    const walk = new NoteWalk()
    expect(walk.step(['a', 'b', 'c', 'd'], 'a', 1)).toBe('b')

    // A search narrowed the list. The remembered sequence describes notes that
    // are no longer on screen, so it is abandoned rather than walked blind.
    expect(walk.step(['b', 'd'], 'b', 1)).toBe('d')
  })

  it('has nowhere to go in a list of one, or none', () => {
    const walk = new NoteWalk()
    expect(walk.step(['a'], 'a', 1)).toBeUndefined()
    expect(walk.step([], '', 1)).toBeUndefined()
    expect(walk.step(['a'], 'a', -1)).toBeUndefined()
  })

  it('enters from the near end when the open note is not in the list', () => {
    // Mid-search the active note can be filtered out of view entirely, leaving
    // no neighbours to step from.
    expect(new NoteWalk().step(['b', 'c'], 'a', 1)).toBe('b')
    expect(new NoteWalk().step(['b', 'c'], 'a', -1)).toBe('c')
  })

  it('forgets its sequence when reset', () => {
    const walk = new NoteWalk()
    expect(walk.step(['a', 'b', 'c'], 'a', 1)).toBe('b')
    walk.reset()
    expect(walk.step(['b', 'a', 'c'], 'b', 1)).toBe('a')
  })

  it('drops a walk whose list collapsed to a single note', () => {
    const walk = new NoteWalk()
    expect(walk.step(['a', 'b', 'c'], 'a', 1)).toBe('b')
    expect(walk.step(['b'], 'b', 1)).toBeUndefined()
    // The abandoned sequence must not resurface once the list refills.
    expect(walk.step(['b', 'x', 'y'], 'b', 1)).toBe('x')
  })
})
