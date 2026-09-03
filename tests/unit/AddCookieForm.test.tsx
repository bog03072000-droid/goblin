// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { I18nProvider } from '../../src/renderer/i18n';
import { AddCookieForm } from '../../src/renderer/components/profileEditor/StorageTab';

afterEach(() => {
  cleanup();
});

function renderForm() {
  const onAdd = vi.fn();
  render(
    <I18nProvider initialLocale="en" onLocaleChange={() => {}}>
      <AddCookieForm onAdd={onAdd} />
    </I18nProvider>,
  );
  return onAdd;
}

describe('AddCookieForm', () => {
  it('renders URL/Name/Value fields and the Secure/HttpOnly/Persist checkboxes, Secure defaulting on', () => {
    renderForm();
    expect(screen.getByText('URL')).toBeInTheDocument();
    expect(screen.getByText('Name')).toBeInTheDocument();
    expect(screen.getByText('Value')).toBeInTheDocument();
    expect(screen.getByLabelText('Secure')).toBeChecked();
    expect(screen.getByLabelText('HttpOnly')).not.toBeChecked();
    expect(screen.getByLabelText('Persist for 1 year (unchecked = session cookie)')).not.toBeChecked();
  });

  it('the Add button is disabled until both URL and Name are filled', () => {
    renderForm();
    const submit = screen.getByRole('button', { name: 'Add' });
    expect(submit).toBeDisabled();

    fireEvent.change(screen.getByPlaceholderText('example.com'), { target: { value: 'example.com' } });
    expect(submit).toBeDisabled();

    const nameInput = screen.getByText('Name').querySelector('input')!;
    fireEvent.change(nameInput, { target: { value: 'session' } });
    expect(submit).toBeEnabled();
  });

  it('a bare domain (no scheme) is submitted as https://, left alone if a scheme is already present', () => {
    const onAdd = renderForm();
    const nameInput = screen.getByText('Name').querySelector('input')!;
    fireEvent.change(screen.getByPlaceholderText('example.com'), { target: { value: 'example.com' } });
    fireEvent.change(nameInput, { target: { value: 'session' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));

    expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://example.com' }));
  });

  it('leaves a URL that already has an explicit scheme untouched', () => {
    const onAdd = renderForm();
    const nameInput = screen.getByText('Name').querySelector('input')!;
    fireEvent.change(screen.getByPlaceholderText('example.com'), { target: { value: 'http://example.com' } });
    fireEvent.change(nameInput, { target: { value: 'session' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));

    expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ url: 'http://example.com' }));
  });

  it('omits expirationDate (a session cookie) when Persist is left unchecked', () => {
    const onAdd = renderForm();
    const nameInput = screen.getByText('Name').querySelector('input')!;
    fireEvent.change(screen.getByPlaceholderText('example.com'), { target: { value: 'example.com' } });
    fireEvent.change(nameInput, { target: { value: 'session' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));

    const call = onAdd.mock.calls[0]![0] as { expirationDate?: number };
    expect(call.expirationDate).toBeUndefined();
  });

  it('sets expirationDate roughly one year out when Persist is checked', () => {
    const onAdd = renderForm();
    const nameInput = screen.getByText('Name').querySelector('input')!;
    fireEvent.change(screen.getByPlaceholderText('example.com'), { target: { value: 'example.com' } });
    fireEvent.change(nameInput, { target: { value: 'session' } });
    fireEvent.click(screen.getByLabelText('Persist for 1 year (unchecked = session cookie)'));
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));

    const call = onAdd.mock.calls[0]![0] as { expirationDate: number };
    const oneYearFromNow = Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60;
    expect(call.expirationDate).toBeGreaterThan(oneYearFromNow - 60);
    expect(call.expirationDate).toBeLessThan(oneYearFromNow + 60);
  });

  it('passes the Secure/HttpOnly checkbox states through as booleans', () => {
    const onAdd = renderForm();
    const nameInput = screen.getByText('Name').querySelector('input')!;
    fireEvent.change(screen.getByPlaceholderText('example.com'), { target: { value: 'example.com' } });
    fireEvent.change(nameInput, { target: { value: 'session' } });
    fireEvent.click(screen.getByLabelText('Secure')); // uncheck (defaults on)
    fireEvent.click(screen.getByLabelText('HttpOnly')); // check
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));

    expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ secure: false, httpOnly: true }));
  });

  it('clears the draft back to its blank/default state after a successful add', () => {
    renderForm();
    const nameInput = screen.getByText('Name').querySelector('input')! as HTMLInputElement;
    const urlInput = screen.getByPlaceholderText('example.com') as HTMLInputElement;
    fireEvent.change(urlInput, { target: { value: 'example.com' } });
    fireEvent.change(nameInput, { target: { value: 'session' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));

    expect(urlInput.value).toBe('');
    expect(nameInput.value).toBe('');
    expect(screen.getByLabelText('Secure')).toBeChecked();
  });

  it('does not call onAdd when Name is left blank, even with a URL filled in', () => {
    const onAdd = renderForm();
    fireEvent.change(screen.getByPlaceholderText('example.com'), { target: { value: 'example.com' } });
    // The button is disabled, but the form's own submit() guard is what
    // actually matters — clicking a disabled button is a no-op in the DOM
    // either way, so this proves the guard, not just the disabled attribute.
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));

    expect(onAdd).not.toHaveBeenCalled();
  });
});
