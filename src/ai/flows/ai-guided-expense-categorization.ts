'use server';
/**
 * @fileOverview An AI assistant for suggesting expense categories based on their description.
 *
 * - suggestExpenseCategory - A function that handles the expense categorization process.
 * - SuggestExpenseCategoryInput - The input type for the suggestExpenseCategory function.
 * - SuggestExpenseCategoryOutput - The return type for the suggestExpenseCategory function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

const SuggestExpenseCategoryInputSchema = z.object({
  expenseDescription: z.string().describe('The description of the expense.'),
});
export type SuggestExpenseCategoryInput = z.infer<typeof SuggestExpenseCategoryInputSchema>;

const SuggestExpenseCategoryOutputSchema = z.object({
  suggestedCategory: z
    .string()
    .describe(
      'The AI-suggested category for the expense. Should be one of the predefined categories or a new, appropriate category if none fit.'
    ),
});
export type SuggestExpenseCategoryOutput = z.infer<typeof SuggestExpenseCategoryOutputSchema>;

export async function suggestExpenseCategory(
  input: SuggestExpenseCategoryInput
): Promise<SuggestExpenseCategoryOutput> {
  return aiGuidedExpenseCategorizationFlow(input);
}

const prompt = ai.definePrompt({
  name: 'aiGuidedExpenseCategorizationPrompt',
  input: {schema: SuggestExpenseCategoryInputSchema},
  output: {schema: SuggestExpenseCategoryOutputSchema},
  prompt: `You are an AI assistant specialized in categorizing restaurant expenses.
Your task is to analyze the provided expense description and suggest the most appropriate category.

Here is a list of common restaurant expense categories:
- Food Purchase
- Salary
- Rent
- Gas
- Electricity Bill
- Maintenance
- Disposable Items
- Marketing & Advertising
- Software & Subscriptions
- Office Supplies
- Insurance
- Taxes
- Miscellaneous

If the expense description clearly fits one of these categories, select it. If none of the predefined categories are a perfect match, suggest a new, appropriate category based on the description.

Expense Description: {{{expenseDescription}}}`,
});

const aiGuidedExpenseCategorizationFlow = ai.defineFlow(
  {
    name: 'aiGuidedExpenseCategorizationFlow',
    inputSchema: SuggestExpenseCategoryInputSchema,
    outputSchema: SuggestExpenseCategoryOutputSchema,
  },
  async input => {
    const {output} = await prompt(input);
    return output!;
  }
);
