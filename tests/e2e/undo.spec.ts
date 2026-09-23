import { expect, test } from '@playwright/test'

import { Workbench } from './workbench'

let wb: Workbench

test.beforeEach(async ({ page }) => {
  wb = new Workbench(page)
  await wb.goto()
  await wb.focusLine(0)
})

const undo = () => wb.press('ControlOrMeta+z')
const redo = () => wb.press('ControlOrMeta+Shift+z')

test('a run of typing is one undo step, and redo puts it back', async () => {
  await wb.type('Vm_init')
  await undo()
  await wb.expectMathJson(null)
  await redo()
  await wb.expectMathJson('Vm_init')
})

test('Ctrl+Y also redoes', async () => {
  await wb.type('ab')
  await undo()
  await wb.press('ControlOrMeta+y')
  await wb.expectMathJson('ab')
})

test('undo takes back one operator and what was typed after it', async () => {
  await wb.type('x+1=2')
  await undo()
  await wb.expectMathJson(['Add', 'x', 1])
  await undo()
  await wb.expectMathJson('x')
  await undo()
  await wb.expectMathJson(null)
})

test('moving the cursor starts a new step', async () => {
  await wb.type('ab')
  await wb.press('ArrowLeft')
  await wb.press('ArrowRight')
  await wb.type('c')
  await undo()
  await wb.expectMathJson('ab')
})

test('a pause starts a new step', async () => {
  await wb.type('ab')
  await wb.page.waitForTimeout(1200)
  await wb.type('c')
  await undo()
  await wb.expectMathJson('ab')
})

test('structures are steps of their own', async () => {
  await wb.type('x^2')
  await undo()
  await wb.expectMathJson(['Power', 'x', ['Missing']])
  await undo()
  await wb.expectMathJson('x')
})

test('stepping out of a structure is not an undo step', async () => {
  await wb.type('x^2')
  await wb.press(' ')
  await undo()
  await wb.expectMathJson(['Power', 'x', ['Missing']])
})

test('repeated Backspace is one step, separate from the typing', async () => {
  await wb.type('abcd')
  await wb.press('Backspace', 3)
  await wb.expectMathJson('a')
  await undo()
  await wb.expectMathJson('abcd')
  await undo()
  await wb.expectMathJson(null)
})

test('typing over a selection is undone in one step', async () => {
  await wb.type('y=a+b')
  await wb.press('Shift+ArrowLeft', 3)
  await wb.type('cd')
  await wb.expectMathJson(['Equal', 'y', 'cd'])
  await undo()
  await wb.expectMathJson(['Equal', 'y', ['Add', 'a', 'b']])
  await expect(wb.selection()).toHaveText('root 2–5')
})
