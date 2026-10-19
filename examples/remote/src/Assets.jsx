// Remote assets the browser requests natively: images (src, srcset), video and
// poster, inline styles, CSS-in-JS backgrounds and fonts, a stylesheet with an
// @import. The e2e suite checks that every one of them loads with the token.
import React from 'react';
import styled, { createGlobalStyle } from 'styled-components';
import clip from './assets/clip.webm';
import cssInJsBg from './assets/css-in-js-bg.png';
// A three-glyph font made for this example (no third-party license).
import font from './assets/fetchalo-sans.woff';
import inlineBg from './assets/inline-bg.png';
import poster from './assets/poster.png';
import srcset1x from './assets/srcset-1x.png';
import srcset2x from './assets/srcset-2x.png';

const FontFace = createGlobalStyle`
  @font-face {
    font-family: 'FetchaloSans';
    src: url(${font}) format('woff');
  }
`;

const CssInJsBox = styled.div`
  width: 40px;
  height: 40px;
  background-image: url(${cssInJsBg});
  font-family: 'FetchaloSans', monospace;
`;

// A stylesheet with an @import (public/styles/theme.css), added with insertBefore like
// some CSS loaders do, and a preload hint, which fetchalo drops instead of letting
// it request without the headers.
function useRemoteStylesheet() {
  React.useEffect(() => {
    const publicDir = `${import.meta.env.BASE_URL}styles/`;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = `${publicDir}theme.css`;
    document.head.insertBefore(link, document.head.firstChild);
    const preload = document.createElement('link');
    preload.rel = 'preload';
    preload.as = 'image';
    preload.href = `${publicDir}imported-bg.png`;
    document.head.append(preload);
    return () => {
      link.remove();
      preload.remove();
    };
  }, []);
}

export default function Assets() {
  useRemoteStylesheet();
  return (
    <section>
      <h2>Remote assets</h2>
      <FontFace />
      <img data-testid="remote-img" src={poster} alt="" />
      <img data-testid="remote-srcset" srcSet={`${srcset1x} 1x, ${srcset2x} 2x`} alt="" />
      <video data-testid="remote-video" src={clip} poster={poster} muted preload="auto" />
      <div
        data-testid="remote-inline-style"
        style={{ width: 40, height: 40, backgroundImage: `url(${inlineBg})` }}
      />
      <CssInJsBox data-testid="remote-css-in-js">Aa</CssInJsBox>
      <div className="remote-import-root" data-testid="remote-import-root">
        <div className="remote-imported" data-testid="remote-imported" />
      </div>
    </section>
  );
}
