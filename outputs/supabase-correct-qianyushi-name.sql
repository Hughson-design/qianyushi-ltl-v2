update public.platform_settings
set company_name = 'Shenzhen Qianyushi Supply Chain Service Co.,Ltd.',
    updated_at = now()
where lower(company_name) like '%qianvushi%';

update public.customers
set name = 'Shenzhen Qianyushi Supply Chain Service Co.,Ltd.',
    code = 'QIANYUSHI',
    updated_at = now()
where is_internal = true;
