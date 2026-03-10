const size = {
  mobileS: '320px', //Small
  mobileM: '375px', //Medium
  mobileL: '475px', //Large
  tablet: '768px',
  laptop: '1024px',
  laptopL: '1440px', //Large
  desktop: '2560px',
  desktopL: '3840px'
}

const device = {
  mobileS: `@media (max-width: ${size.mobileS})`,
  mobileM: `@media (max-width: ${size.mobileM})`,
  mobileL: `@media (max-width: ${size.mobileL})`,
  tablet: `@media (max-width: ${size.tablet})`,
  laptop: `@media (max-width: ${size.laptop})`,
  laptopL: `@media (max-width: ${size.laptopL})`,
  desktop: `@media (max-width: ${size.desktop})`,
  desktopL: `@media (max-width: ${size.desktopL})`
}

export default device

//Modo de uso
//
//import { device } from "../bases/devices";
//
// export const Name = styled.div`
//     width: 10px;
//     ${device.laptop} {
//       width: 5px;
//     }
// `;
