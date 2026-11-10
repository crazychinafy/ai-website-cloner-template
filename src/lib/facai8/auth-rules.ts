// 认证校验规则（源站 1:1；前后端共用）
// 源站定义：ai=密码强度正则、oi=密码文案、Cr=图片验证码正则（index chunk）；
// 邮箱正则 /^[\w.-]+@[\w.-]+\.\w+$/ 与用户名 /^(?=.*[a-z])[a-z0-9]{5,20}$/（Register chunk 验证器）。
export const PWD_RE = /^[A-Za-z0-9!@#$%^&*()_+\-=[\]{},.?/:;|~]{8,50}$/
export const PWD_MSG = '密码8-50位，只能包含字母、数字和常用符号，不能有空格'
export const CAPTCHA_RE = /^[A-Za-z0-9]{4}$/
export const EMAIL_RE = /^[\w.-]+@[\w.-]+\.\w+$/
export const USERNAME_RE = /^(?=.*[a-z])[a-z0-9]{5,20}$/
export const SMS_CODE_RE = /^\d{6}$/
