/** A filled robot head on the 24 px icon grid, reduced from the product logo; it takes the text color. */
export function RobotHeadIcon({ className }: { className?: string }) {
  return <svg aria-hidden className={className} fill="currentColor" height="24" viewBox="0 0 24 24" width="24" xmlns="http://www.w3.org/2000/svg">
    <path d="M5.4 9.1V8.3C5.4 4.4 8.1 1.2 12 1.2S18.6 4.4 18.6 8.3V9.1H19.6V10.5H18.6V14C18.6 15.2 17.3 16.2 16.7 17.4L15.7 22.8H8.3L7.3 17.4C6.7 16.2 5.4 15.2 5.4 14V10.5H4.4V9.1ZM5.4 9.7H11.5L11.1 12.2C11 12.9 10.5 13.3 9.9 13.3H7.5C6.6 13.3 6.1 12.8 5.9 12.1ZM18.6 9.7H12.5L12.9 12.2C13 12.9 13.5 13.3 14.1 13.3H16.5C17.4 13.3 17.9 12.8 18.1 12.1ZM12 14.4L11 16.3H13ZM8.9 18H15.1V19.6H8.9Z" fillRule="evenodd" />
  </svg>;
}
