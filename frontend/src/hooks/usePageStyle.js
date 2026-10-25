import { useLayoutEffect } from 'react';
import uiCss from '../styles/ui.css?inline';

/**
 * Every page of the original app shipped its own <style> block followed by the shared ui.css, and
 * those sheets use global selectors (`body`, `nav`, `main`, `.hero` ...) with different values per page.
 * To keep every page pixel-identical, the page's sheet and then ui.css are mounted while the page is
 * on screen and removed when it leaves, so styles can never leak from one route into another.
 */
export function usePageStyle(pageCss, title) {
  useLayoutEffect(() => {
    const page = document.createElement('style');
    page.dataset.pageStyle = 'page';
    page.textContent = pageCss;
    const ui = document.createElement('style');
    ui.dataset.pageStyle = 'ui';
    ui.textContent = uiCss;
    document.head.append(page, ui);
    const previousTitle = document.title;
    if (title) document.title = title;
    return () => {
      page.remove();
      ui.remove();
      document.title = previousTitle;
    };
  }, [pageCss, title]);
}
