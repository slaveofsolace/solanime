// @vitest-environment jsdom
import {cleanup, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {MemoryRouter} from 'react-router-dom';
import CategoryNavigation from '../src/components/CategoryNavigation';
import {SpotlightArtwork} from '../src/components/FeatureSpotlight';
const {filters} = vi.hoisted(()=>({filters:vi.fn()}));
vi.mock('../src/lib/api',()=>({api:{filters}}));
const title={id:'one',source:'anikoto',slug:'one',name:'One',posterUrl:'https://art.example/poster.jpg',backdropUrl:'https://art.example/banner.jpg'};
afterEach(cleanup);
beforeEach(()=>{filters.mockReset();});
describe('category navigation',()=>{
 it('loads on demand, caches genres, and restores keyboard focus on Escape',async()=>{
  filters.mockResolvedValue({genres:[{value:'slice-of-life',label:'Slice of Life'}]});
  render(<MemoryRouter><CategoryNavigation/></MemoryRouter>);
  const button=screen.getByRole('button',{name:'Categories'});
  expect(filters).not.toHaveBeenCalled();
  fireEvent.click(button);
  const link=await screen.findByRole('link',{name:'Slice of Life'});
  expect(link.getAttribute('href')).toBe('/catalogue?scope=anime&genre=slice-of-life');
  link.focus(); fireEvent.keyDown(link,{key:'Escape'});
  expect(document.activeElement).toBe(button);
  expect(button.getAttribute('aria-expanded')).toBe('false');
  fireEvent.click(button);
  expect(filters).toHaveBeenCalledTimes(1);
 });
 it('distinguishes genuine empty results from loading',async()=>{
  filters.mockResolvedValue({genres:[]});
  render(<MemoryRouter><CategoryNavigation/></MemoryRouter>);
  fireEvent.click(screen.getByRole('button',{name:'Categories'}));
  await screen.findByText('No genres available.');
  expect(screen.queryByText('Loading genres…')).toBeNull();
 });
 it('keeps direct navigation after failure and retries when reopened',async()=>{
  filters.mockRejectedValueOnce(new Error('Unavailable')).mockResolvedValueOnce({genres:[]});
  render(<MemoryRouter><CategoryNavigation/></MemoryRouter>);
  const button=screen.getByRole('button',{name:'Categories'});
  fireEvent.click(button);
  await screen.findByText('Browse all anime to filter by genre.');
  expect(screen.getByRole('link',{name:'Dubbed anime'}).getAttribute('href')).toContain('language=dub');
  fireEvent.pointerDown(document.body);
  expect(button.getAttribute('aria-expanded')).toBe('false');
  fireEvent.click(button);
  await screen.findByText('No genres available.');
  expect(filters).toHaveBeenCalledTimes(2);
 });
 it('aborts a request when the menu closes',async()=>{
  filters.mockImplementation(()=>new Promise(()=>{}));
  render(<MemoryRouter><CategoryNavigation/></MemoryRouter>);
  const button=screen.getByRole('button',{name:'Categories'});
  fireEvent.click(button);
  const signal=filters.mock.calls[0][0];
  fireEvent.click(button);
  await waitFor(()=>expect(signal.aborted).toBe(true));
 });
});
describe('hero artwork sizing',()=>{
 it('identifies panoramic strips from loaded dimensions without stretching the source',()=>{
  const {container}=render(<SpotlightArtwork title={title}/>);
  const image=container.querySelector('.spotlight-art__banner')!;
  Object.defineProperties(image,{naturalWidth:{value:1900},naturalHeight:{value:400}});
  fireEvent.load(image);
  expect(container.firstElementChild?.getAttribute('data-banner-shape')).toBe('strip');
  expect(container.firstElementChild?.getAttribute('data-banner')).toBe('loaded');
 });
 it('keeps normal landscape artwork distinct from a panoramic strip',()=>{
  const {container}=render(<SpotlightArtwork title={title}/>);
  const image=container.querySelector('.spotlight-art__banner')!;
  Object.defineProperties(image,{naturalWidth:{value:1920},naturalHeight:{value:1080}});
  fireEvent.load(image);
  expect(container.firstElementChild?.getAttribute('data-banner-shape')).toBe('landscape');
 });
 it('keeps the original poster when the backdrop fails',()=>{
  const {container}=render(<SpotlightArtwork title={title}/>);
  fireEvent.error(container.querySelector('.spotlight-art__banner')!);
  expect(container.firstElementChild?.getAttribute('data-banner')).toBe('failed');
  expect(container.querySelector('.spotlight-art__poster img')?.getAttribute('src')).toBe(title.posterUrl);
 });
});
